use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FactItem {
    pub id: Option<i64>,
    pub fact: String,
    pub category: Option<String>,
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct RememberRequest {
    pub text: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RememberResponse {
    pub status: String,
    pub facts_extracted: Vec<FactItem>,
    pub saved_count: usize,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct AskRequest {
    pub question: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub answer: String,
    pub retrieved_facts: Vec<FactItem>,
    pub model_used: String,
}

#[derive(Debug, Serialize)]
pub struct FactsListResponse {
    pub facts: Vec<FactItem>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String,
    pub memory_count: usize,
    pub embedding_model: String,
    pub llm_model: String,
    pub has_groq_key: bool,
    pub db_location: String,
}

#[derive(Debug, Deserialize)]
pub struct PasswordRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct PasswordResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct HasPasswordResponse {
    pub has_password: bool,
}
