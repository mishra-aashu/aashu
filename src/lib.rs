pub mod config;
pub mod db;
pub mod embeddings;
pub mod groq;
pub mod models;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use config::Config;
use db::Database;
use embeddings::EmbeddingEngine;
use groq::GroqClient;
use models::{
    AskRequest, AskResponse, FactItem, FactsListResponse, HasPasswordResponse, PasswordRequest,
    PasswordResponse, RememberRequest, RememberResponse, StatusResponse, UpdateFactRequest,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub embedder: Arc<EmbeddingEngine>,
    pub groq: GroqClient,
    pub config: Config,
}

impl AppState {
    pub fn get_effective_groq_key(&self) -> String {
        if let Ok(Some(key)) = self.db.get_setting("groq_api_key") {
            if !key.trim().is_empty() {
                return key.trim().to_string();
            }
        }
        self.config.groq_api_key.clone()
    }
}

pub fn hash_password(password: &str) -> String {
    let salt = "aashu_ai_secure_salt_v1_2026";
    let combined = format!("{}:{}", salt, password.trim());
    let mut hash1: u64 = 0xcbf29ce484222325;
    for b in combined.bytes() {
        hash1 ^= b as u64;
        hash1 = hash1.wrapping_mul(0x100000001b3);
    }
    let mut hash2: u64 = 0x517cc1b727220a95;
    for b in combined.bytes().rev() {
        hash2 ^= b as u64;
        hash2 = hash2.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}{:016x}", hash1, hash2)
}

fn check_authorization(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let stored_pwd = match state.db.get_setting("app_password") {
        Ok(Some(pwd)) if !pwd.trim().is_empty() => pwd,
        _ => return Ok(()), // No password configured; allow access
    };

    // Extract password from x-app-password or authorization header
    let provided_pwd = headers
        .get("x-app-password")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.strip_prefix("Bearer ").unwrap_or(s))
        });

    match provided_pwd {
        Some(token) => {
            let hashed = hash_password(token);
            if hashed == stored_pwd || token.trim() == stored_pwd {
                Ok(())
            } else {
                Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "status": "error",
                        "message": "Invalid security password or session token."
                    })),
                ))
            }
        }
        None => Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "message": "Authentication required. Please unlock the app."
            })),
        )),
    }
}

fn resolve_public_dir() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join("public");
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
            if let Some(parent) = exe_dir.parent() {
                let candidate2 = parent.join("public");
                if candidate2.exists() {
                    return candidate2.to_string_lossy().to_string();
                }
            }
        }
    }
    "public".to_string()
}

pub async fn start_server() -> anyhow::Result<()> {
    // Setup tracing/logging if not already initialized
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    info!("Starting AI Voice Memory System Backend...");

    let config = Config::from_env();
    info!("Loaded config: Model = {}, Port = {}", config.groq_model, config.port);

    let db = Database::new(&config.db_path)?;
    let embedder = Arc::new(EmbeddingEngine::new());
    let groq = GroqClient::new(config.clone());

    let state = AppState {
        db,
        embedder,
        groq,
        config: config.clone(),
    };

    let api_routes = Router::new()
        .route("/remember", post(remember_handler))
        .route("/ask", post(ask_handler))
        .route("/facts", get(get_facts_handler))
        .route("/facts/summary", get(summarize_facts_handler))
        .route("/facts/:id", delete(delete_fact_handler))
        .route("/facts/:id", put(update_fact_handler))
        .route("/facts/:id/pin", patch(toggle_pin_fact_handler))
        .route("/status", get(status_handler))
        .route("/set-password", post(set_password_handler))
        .route("/verify-password", post(verify_password_handler))
        .route("/has-password", get(has_password_handler))
        .route("/settings/groq-key", post(save_groq_key_handler))
        .route("/settings/groq-key", get(get_groq_key_status_handler))
        .route("/reset-data", post(reset_data_handler));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new(resolve_public_dir()))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Server listening on http://{}", addr);

    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            axum::serve(listener, app).await?;
        }
        Err(e) => {
            tracing::warn!("Could not bind to http://{} (server may already be running): {}", addr, e);
        }
    }

    Ok(())
}

async fn remember_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RememberRequest>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    if req.text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(RememberResponse {
                status: "error".to_string(),
                facts_extracted: vec![],
                saved_count: 0,
                message: "Input text cannot be empty.".to_string(),
            }),
        ).into_response();
    }

    info!("Processing /remember text: '{}'", req.text);

    let effective_key = state.get_effective_groq_key();

    // 1. Extract facts via Groq LLM
    let extracted_facts = match state.groq.extract_facts(&req.text, req.model.as_deref(), Some(&effective_key)).await {
        Ok(facts) => facts,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RememberResponse {
                    status: "error".to_string(),
                    facts_extracted: vec![],
                    saved_count: 0,
                    message: format!("Failed to extract facts: {}", e),
                }),
            ).into_response();
        }
    };

    // 2. Embed each fact & save to local SQLite vector store
    let mut saved_count = 0;
    let mut saved_facts = Vec::new();

    for mut fact in extracted_facts {
        match state.embedder.embed_single(&fact.fact) {
            Ok(vec) => match state.db.insert_fact(&fact, &vec) {
                Ok(id) => {
                    fact.id = Some(id);
                    saved_facts.push(fact);
                    saved_count += 1;
                }
                Err(e) => {
                    tracing::warn!("Failed to insert fact into DB: {}", e);
                }
            },
            Err(e) => {
                tracing::warn!("Failed to embed fact text: {}", e);
            }
        }
    }

    (
        StatusCode::OK,
        Json(RememberResponse {
            status: "success".to_string(),
            facts_extracted: saved_facts,
            saved_count,
            message: format!("Successfully saved {} facts into vector memory.", saved_count),
        }),
    ).into_response()
}

async fn ask_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AskRequest>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    let chosen_model = req
        .model
        .as_ref()
        .filter(|m| !m.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| state.config.groq_model.clone());

    if req.question.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(AskResponse {
                answer: "Please provide a non-empty question.".to_string(),
                retrieved_facts: vec![],
                model_used: chosen_model,
            }),
        ).into_response();
    }

    info!("Processing /ask question with model '{}': '{}'", chosen_model, req.question);

    // 1. Embed query locally
    let query_vec = match state.embedder.embed_single(&req.question) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AskResponse {
                    answer: format!("Failed to compute query vector: {}", e),
                    retrieved_facts: vec![],
                    model_used: chosen_model,
                }),
            ).into_response();
        }
    };

    // 2. Fetch top 5 vector similar facts from SQLite DB
    let relevant_facts = match state.db.search_similar_facts(&query_vec, 5) {
        Ok(facts) => facts,
        Err(e) => {
            tracing::warn!("Failed to query DB vector similarity: {}", e);
            vec![]
        }
    };

    // 3. Ask Groq API with query, context facts & chat history
    let effective_key = state.get_effective_groq_key();
    let answer = match state
        .groq
        .answer_question(&req.question, &relevant_facts, Some(&chosen_model), req.history.as_deref(), Some(&effective_key))
        .await
    {
        Ok(ans) => ans,
        Err(e) => format!("Failed to generate answer: {}", e),
    };

    (
        StatusCode::OK,
        Json(AskResponse {
            answer,
            retrieved_facts: relevant_facts,
            model_used: chosen_model,
        }),
    ).into_response()
}

async fn get_facts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    match state.db.get_all_facts() {
        Ok(facts) => {
            let total = facts.len();
            (StatusCode::OK, Json(FactsListResponse { facts, total })).into_response()
        }
        Err(_e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FactsListResponse {
                facts: vec![],
                total: 0,
            }),
        ).into_response(),
    }
}

async fn summarize_facts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    let facts = match state.db.get_all_facts() {
        Ok(f) => f,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "status": "error",
                    "summary": format!("Failed to load facts: {}", e)
                })),
            ).into_response();
        }
    };

    if facts.is_empty() {
        return (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "summary": "I don't have any stored memories about you yet. Try telling me something like 'Remember that I live in Pune and work as a software engineer'!"
            })),
        ).into_response();
    }

    let effective_key = state.get_effective_groq_key();
    let prompt = "Summarize everything you know about the user based strictly on these memories into a friendly, structured persona summary with bullet points:";
    let summary = match state
        .groq
        .answer_question(prompt, &facts, None, None, Some(&effective_key))
        .await
    {
        Ok(ans) => ans,
        Err(_) => {
            let mut fallback = String::from("Here is a summary of what I know about you:\n\n");
            for f in &facts {
                fallback.push_str(&format!("• {} (Category: {})\n", f.fact, f.category.as_deref().unwrap_or("General")));
            }
            fallback
        }
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "success",
            "summary": summary,
            "total_facts": facts.len()
        })),
    ).into_response()
}

async fn delete_fact_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    match state.db.delete_fact(id) {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({"status": "success", "id": id}))).into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"status": "not_found", "id": id}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"status": "error", "message": e.to_string()}))).into_response(),
    }
}

async fn update_fact_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateFactRequest>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    if req.fact.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "Fact text cannot be empty."
            })),
        ).into_response();
    }

    let embedding = match state.embedder.embed_single(&req.fact) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "status": "error",
                    "message": format!("Failed to compute vector embedding: {}", e)
                })),
            ).into_response();
        }
    };

    let updated_item = FactItem {
        id: Some(id),
        fact: req.fact,
        category: req.category,
        date: req.date,
        is_pinned: req.is_pinned,
        score: None,
    };

    match state.db.update_fact(id, &updated_item, &embedding) {
        Ok(true) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "message": "Fact updated and re-embedded successfully."
            })),
        ).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "status": "error",
                "message": "Fact ID not found."
            })),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "status": "error",
                "message": e.to_string()
            })),
        ).into_response(),
    }
}

async fn toggle_pin_fact_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    match state.db.toggle_pin_fact(id) {
        Ok(true) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "message": "Fact pin status toggled."
            })),
        ).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "status": "error",
                "message": "Fact ID not found."
            })),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "status": "error",
                "message": e.to_string()
            })),
        ).into_response(),
    }
}

async fn status_handler(State(state): State<AppState>) -> impl IntoResponse {
    let memory_count = state.db.get_facts_count().unwrap_or(0);
    let effective_key = state.get_effective_groq_key();
    let has_key = !effective_key.trim().is_empty() && !effective_key.contains("YOUR_GROQ_API_KEY");

    let response = StatusResponse {
        status: "online".to_string(),
        memory_count,
        embedding_model: "Synonym-Aware 384-Dim (Local CPU)".to_string(),
        llm_model: state.config.groq_model.clone(),
        has_groq_key: has_key,
        db_location: state.config.db_path.clone(),
    };
    Json(response)
}

#[derive(serde::Deserialize)]
struct SaveGroqKeyRequest {
    api_key: String,
}

async fn save_groq_key_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SaveGroqKeyRequest>,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    match state.db.set_setting("groq_api_key", req.api_key.trim()) {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "message": "Groq API Key updated successfully."
            })),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "status": "error",
                "message": e.to_string()
            })),
        ).into_response(),
    }
}

async fn get_groq_key_status_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    let key = state.get_effective_groq_key();
    let is_configured = !key.trim().is_empty() && !key.contains("YOUR_GROQ_API_KEY");
    let masked_key = if is_configured && key.len() > 8 {
        format!("{}...{}", &key[..4], &key[key.len() - 4..])
    } else if is_configured {
        "Configured".to_string()
    } else {
        "Not Set".to_string()
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "is_configured": is_configured,
            "masked_key": masked_key
        })),
    ).into_response()
}

async fn set_password_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PasswordRequest>,
) -> impl IntoResponse {
    // If a password is already set, verify current auth before allowing password change
    if let Ok(Some(existing)) = state.db.get_setting("app_password") {
        if !existing.trim().is_empty() {
            if let Err(auth_err) = check_authorization(&state, &headers) {
                return auth_err.into_response();
            }
        }
    }

    let pwd = req.password.trim();
    if pwd.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(PasswordResponse {
                success: false,
                message: "Password cannot be empty".to_string(),
            }),
        ).into_response();
    }

    let hashed_pwd = hash_password(pwd);
    match state.db.set_setting("app_password", &hashed_pwd) {
        Ok(_) => (
            StatusCode::OK,
            Json(PasswordResponse {
                success: true,
                message: "Password configured securely and stored as salted hash in database.".to_string(),
            }),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResponse {
                success: false,
                message: format!("DB Error: {}", e),
            }),
        ).into_response(),
    }
}

async fn verify_password_handler(
    State(state): State<AppState>,
    Json(req): Json<PasswordRequest>,
) -> impl IntoResponse {
    match state.db.get_setting("app_password") {
        Ok(Some(stored_pwd)) => {
            let provided_raw = req.password.trim();
            let provided_hashed = hash_password(provided_raw);

            if provided_hashed == stored_pwd {
                (
                    StatusCode::OK,
                    Json(PasswordResponse {
                        success: true,
                        message: "Password verified successfully.".to_string(),
                    }),
                )
            } else if provided_raw == stored_pwd {
                // Auto-upgrade legacy plaintext password in DB to salted hash
                let _ = state.db.set_setting("app_password", &provided_hashed);
                (
                    StatusCode::OK,
                    Json(PasswordResponse {
                        success: true,
                        message: "Password verified and upgraded to secure hash.".to_string(),
                    }),
                )
            } else {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(PasswordResponse {
                        success: false,
                        message: "Incorrect password. Access denied.".to_string(),
                    }),
                )
            }
        }
        Ok(None) => (
            StatusCode::OK,
            Json(PasswordResponse {
                success: true,
                message: "No password configured.".to_string(),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResponse {
                success: false,
                message: format!("DB Error: {}", e),
            }),
        ),
    }
}

async fn has_password_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.get_setting("app_password") {
        Ok(Some(pwd)) => (
            StatusCode::OK,
            Json(HasPasswordResponse {
                has_password: !pwd.trim().is_empty(),
            }),
        ),
        _ => (
            StatusCode::OK,
            Json(HasPasswordResponse {
                has_password: false,
            }),
        ),
    }
}

async fn reset_data_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(auth_err) = check_authorization(&state, &headers) {
        return auth_err.into_response();
    }

    match state.db.reset_all_data() {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"status": "success", "message": "All data reset successfully."})),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "message": e.to_string()})),
        ).into_response(),
    }
}
