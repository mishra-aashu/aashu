use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
        let groq_model = env::var("GROQ_MODEL").unwrap_or_else(|_| "llama-3.3-70b-versatile".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let db_path = match env::var("DATABASE_PATH") {
            Ok(val) => val,
            Err(_) => Self::resolve_default_db_path(),
        };

        Config {
            groq_api_key,
            groq_model,
            port,
            db_path,
        }
    }

    fn resolve_default_db_path() -> String {
        let home_dir = env::var("HOME")
            .or_else(|_| env::var("USERPROFILE"))
            .ok();

        if let Some(home) = home_dir {
            let app_data_dir = if cfg!(target_os = "windows") {
                env::var("APPDATA")
                    .map(|appdata| PathBuf::from(appdata).join("Aashu AI"))
                    .unwrap_or_else(|_| PathBuf::from(&home).join("AppData").join("Roaming").join("Aashu AI"))
            } else {
                PathBuf::from(&home).join(".local").join("share").join("aashu")
            };
            if let Err(e) = fs::create_dir_all(&app_data_dir) {
                eprintln!("Failed to create AppData directory: {}", e);
                return "memory.db".to_string();
            }

            let target_db = app_data_dir.join("memory.db");

            // Automatically migrate local `./memory.db` if present
            let local_db = Path::new("memory.db");
            if local_db.exists() && !target_db.exists() {
                if let Err(e) = fs::copy(local_db, &target_db) {
                    eprintln!("Failed to migrate local database to AppData: {}", e);
                } else {
                    println!("Successfully migrated local memory.db to {:?}", target_db);
                }
            }

            target_db.to_string_lossy().to_string()
        } else {
            "memory.db".to_string()
        }
    }

    pub fn has_valid_groq_key(&self) -> bool {
        !self.groq_api_key.is_empty() && !self.groq_api_key.contains("your_groq_api_key") && !self.groq_api_key.contains("demo_key")
    }
}
