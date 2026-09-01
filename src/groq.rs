use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::warn;

use crate::config::Config;
use crate::models::FactItem;

#[derive(Clone)]
pub struct GroqClient {
    client: Client,
    config: Config,
}

impl GroqClient {
    pub fn new(config: Config) -> Self {
        GroqClient {
            client: Client::new(),
            config,
        }
    }

    pub async fn extract_facts(&self, text: &str) -> Result<Vec<FactItem>> {
        if !self.config.has_valid_groq_key() {
            warn!("GROQ_API_KEY is not configured. Using local fallback fact extractor.");
            return Ok(self.fallback_extract_facts(text));
        }

        let system_prompt = r#"You are an AI fact extraction system. Extract discrete, clear, atomic facts from user statements.
Return ONLY a valid JSON array of objects with keys:
- "fact": String (the extracted memory fact)
- "category": String (e.g., "Personal", "Preference", "Work", "Location", "Schedule")
- "date": String (the date or time frame mentioned, or "N/A" if none)

Example Output:
[{"fact": "User moved to Pune in 2023", "category": "Location", "date": "2023"}]

Strict Rule: Return ONLY raw JSON array. No markdown code blocks, no explanation text."#;

        let payload = json!({
            "model": self.config.groq_model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": text }
            ],
            "temperature": 0.1,
            "max_tokens": 1024
        });

        let response = self
            .client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.config.groq_api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_text = response.text().await.unwrap_or_default();
            warn!("Groq API error: {}. Falling back to local extractor.", err_text);
            return Ok(self.fallback_extract_facts(text));
        }

        let json_body: Value = response.json().await?;
        let content = json_body["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow!("Invalid Groq response content structure"))?;

        // Clean json from potential backticks
        let cleaned_json = content
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        match serde_json::from_str::<Vec<FactItem>>(cleaned_json) {
            Ok(facts) => Ok(facts),
            Err(e) => {
                warn!("Failed to parse JSON from Groq API output ({}), falling back.", e);
                Ok(self.fallback_extract_facts(text))
            }
        }
    }

    pub async fn answer_question(&self, question: &str, facts: &[FactItem]) -> Result<String> {
        if !self.config.has_valid_groq_key() {
            warn!("GROQ_API_KEY is not configured. Generating context-backed response locally.");
            return Ok(self.fallback_answer_question(question, facts));
        }

        let mut context_str = String::new();
        for (i, f) in facts.iter().enumerate() {
            context_str.push_str(&format!(
                "{}. {} [Category: {}, Date: {}]\n",
                i + 1,
                f.fact,
                f.category.as_deref().unwrap_or("General"),
                f.date.as_deref().unwrap_or("N/A")
            ));
        }

        let system_prompt = format!(
            "You are an AI personal assistant with access to long-term memory facts retrieved from a local vector database.\n\nRetrieved Memory Context:\n{}\nAnswer the user's question accurately using ONLY the retrieved facts above. Be direct, conversational, and helpful.",
            if context_str.is_empty() { "No relevant memories found in database." } else { &context_str }
        );

        let payload = json!({
            "model": self.config.groq_model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": question }
            ],
            "temperature": 0.3,
            "max_tokens": 1024
        });

        let response = self
            .client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.config.groq_api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_text = response.text().await.unwrap_or_default();
            warn!("Groq API error on answer: {}. Using fallback.", err_text);
            return Ok(self.fallback_answer_question(question, facts));
        }

        let json_body: Value = response.json().await?;
        let content = json_body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("Unable to generate answer.")
            .to_string();

        Ok(content)
    }

    fn fallback_extract_facts(&self, text: &str) -> Vec<FactItem> {
        let sentences: Vec<&str> = text
            .split(&['.', '!', '?', '\n'][..])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        if sentences.is_empty() {
            return vec![FactItem {
                id: None,
                fact: text.trim().to_string(),
                category: Some("General".to_string()),
                date: Some("N/A".to_string()),
                score: None,
            }];
        }

        sentences
            .into_iter()
            .map(|s| FactItem {
                id: None,
                fact: s.to_string(),
                category: Some("Extracted Fact".to_string()),
                date: Some("N/A".to_string()),
                score: None,
            })
            .collect()
    }

    fn fallback_answer_question(&self, question: &str, facts: &[FactItem]) -> String {
        if facts.is_empty() {
            return format!("I checked your local vector memory, but couldn't find any relevant facts related to '{}'.", question);
        }

        let fact_list: Vec<String> = facts.iter().map(|f| format!("• {}", f.fact)).collect();
        format!(
            "Based on your local vector memory, here is what I know about your query:\n\n{}\n\n(Note: Connect your Groq API Key in `.env` for full Llama-3.3-70b AI reasoning output!)",
            fact_list.join("\n")
        )
    }
}
