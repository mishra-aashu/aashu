use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod config;
mod db;
mod embeddings;
mod groq;
mod models;

use config::Config;
use db::Database;
use embeddings::EmbeddingEngine;
use groq::GroqClient;
use models::{
    AskRequest, AskResponse, FactsListResponse, HasPasswordResponse, PasswordRequest,
    PasswordResponse, RememberRequest, RememberResponse, StatusResponse,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub embedder: Arc<EmbeddingEngine>,
    pub groq: GroqClient,
    pub config: Config,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Setup tracing/logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("setting default subscriber failed");

    info!("Starting AI Voice Memory System...");

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
        .route("/facts/:id", delete(delete_fact_handler))
        .route("/status", get(status_handler))
        .route("/set-password", post(set_password_handler))
        .route("/verify-password", post(verify_password_handler))
        .route("/has-password", get(has_password_handler))
        .route("/reset-data", post(reset_data_handler));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new("public"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn remember_handler(
    State(state): State<AppState>,
    Json(req): Json<RememberRequest>,
) -> impl IntoResponse {
    if req.text.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(RememberResponse {
                status: "error".to_string(),
                facts_extracted: vec![],
                saved_count: 0,
                message: "Input text cannot be empty.".to_string(),
            }),
        );
    }

    info!("Processing /remember text: '{}'", req.text);

    // 1. Extract facts via Groq LLM
    let extracted_facts = match state.groq.extract_facts(&req.text, req.model.as_deref()).await {
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
            );
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
    )
}

async fn ask_handler(
    State(state): State<AppState>,
    Json(req): Json<AskRequest>,
) -> impl IntoResponse {
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
        );
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
            );
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

    // 3. Ask Groq API with query & context facts
    let answer = match state
        .groq
        .answer_question(&req.question, &relevant_facts, Some(&chosen_model))
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
    )
}

async fn get_facts_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.get_all_facts() {
        Ok(facts) => {
            let total = facts.len();
            (StatusCode::OK, Json(FactsListResponse { facts, total }))
        }
        Err(_e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FactsListResponse {
                facts: vec![],
                total: 0,
            }),
        ),
    }
}

async fn delete_fact_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match state.db.delete_fact(id) {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({"status": "success", "id": id}))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"status": "not_found", "id": id}))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"status": "error", "message": e.to_string()}))),
    }
}

async fn status_handler(State(state): State<AppState>) -> impl IntoResponse {
    let memory_count = state.db.get_facts_count().unwrap_or(0);
    let response = StatusResponse {
        status: "online".to_string(),
        memory_count,
        embedding_model: "bge-small-en-v1.5 (Local CPU)".to_string(),
        llm_model: state.config.groq_model.clone(),
        has_groq_key: state.config.has_valid_groq_key(),
        db_location: state.config.db_path.clone(),
    };
    Json(response)
}

async fn set_password_handler(
    State(state): State<AppState>,
    Json(req): Json<PasswordRequest>,
) -> impl IntoResponse {
    let pwd = req.password.trim();
    if pwd.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(PasswordResponse {
                success: false,
                message: "Password cannot be empty".to_string(),
            }),
        );
    }

    match state.db.set_setting("app_password", pwd) {
        Ok(_) => (
            StatusCode::OK,
            Json(PasswordResponse {
                success: true,
                message: "Password configured and stored in database.".to_string(),
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

async fn verify_password_handler(
    State(state): State<AppState>,
    Json(req): Json<PasswordRequest>,
) -> impl IntoResponse {
    match state.db.get_setting("app_password") {
        Ok(Some(stored_pwd)) => {
            if stored_pwd == req.password.trim() {
                (
                    StatusCode::OK,
                    Json(PasswordResponse {
                        success: true,
                        message: "Password verified successfully.".to_string(),
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

async fn reset_data_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.reset_all_data() {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"status": "success", "message": "All data reset successfully."})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "message": e.to_string()})),
        ),
    }
}
