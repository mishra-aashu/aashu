use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub groq_api_key: String,
    pub groq_model: String,
    pub port: u16,
    pub db_path: String,
}

impl Config {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();

        let groq_api_key = env::var("GROQ_API_KEY").unwrap_or_default();
        let groq_model = env::var("GROQ_MODEL").unwrap_or_else(|_| "openai/gpt-oss-20b".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        let db_path = env::var("DATABASE_PATH").unwrap_or_else(|_| "memory.db".to_string());

        Config {
            groq_api_key,
            groq_model,
            port,
            db_path,
        }
    }

    pub fn has_valid_groq_key(&self) -> bool {
        !self.groq_api_key.is_empty() && !self.groq_api_key.contains("your_groq_api_key") && !self.groq_api_key.contains("demo_key")
    }
}
