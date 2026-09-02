use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::warn;

use crate::config::Config;
use crate::models::{ChatMessage, FactItem};

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

    pub async fn extract_facts(&self, text: &str, target_model: Option<&str>, api_key_override: Option<&str>) -> Result<Vec<FactItem>> {
        let key = api_key_override
            .filter(|k| !k.trim().is_empty())
            .unwrap_or(&self.config.groq_api_key);

        if key.trim().is_empty() || key.contains("YOUR_GROQ_API_KEY") {
            warn!("GROQ_API_KEY is not configured. Using local fallback fact extractor.");
            return Ok(self.fallback_extract_facts(text));
        }

        let selected_model = target_model
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(&self.config.groq_model);

        let system_prompt = r#"You are an AI fact extraction system. Extract discrete, clear, atomic facts from user statements.
Return ONLY a valid JSON array of objects with keys:
- "fact": String (the extracted memory fact)
- "category": String (e.g., "Personal", "Preference", "Work", "Location", "Schedule")
- "date": String (the date or time frame mentioned, or "N/A" if none)

Example Output:
[{"fact": "User moved to Pune in 2023", "category": "Location", "date": "2023"}]

Strict Rule: Return ONLY raw JSON array. No markdown code blocks, no explanation text."#;

        let payload = json!({
            "model": selected_model,
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
            .header("Authorization", format!("Bearer {}", key))
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

    pub async fn answer_question(
        &self,
        question: &str,
        facts: &[FactItem],
        target_model: Option<&str>,
        history: Option<&[ChatMessage]>,
        api_key_override: Option<&str>,
    ) -> Result<String> {
        let key = api_key_override
            .filter(|k| !k.trim().is_empty())
            .unwrap_or(&self.config.groq_api_key);

        if key.trim().is_empty() || key.contains("YOUR_GROQ_API_KEY") {
            warn!("GROQ_API_KEY is not configured. Generating context-backed response locally.");
            return Ok(self.fallback_answer_question(question, facts));
        }

        let selected_model = target_model
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(&self.config.groq_model);

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
            "You are Aashu AI, an intelligent personal AI assistant equipped with long-term vector memory.\n\nRetrieved Memory Context:\n{}\n\nInstruction:\n1. Use the retrieved memory facts above as your primary memory to answer the user's question directly, accurately, and naturally.\n2. Synthesize all relevant facts gracefully. If the retrieved facts contain details about the user's location, preferences, or history, state them clearly.\n3. Keep your tone warm, concise, and helpful. Do not mention system details like 'vector database' unless asked.\n4. Language Fluency: Automatically detect the user's language. If the user asks in Hindi (Hindi script or Hinglish), respond in fluent, natural Hindi/Hinglish.",
            if context_str.is_empty() { "No relevant memories found in vector store." } else { &context_str }
        );

        let mut messages = Vec::new();
        messages.push(json!({ "role": "system", "content": system_prompt }));

        if let Some(hist) = history {
            let start = if hist.len() > 10 { hist.len() - 10 } else { 0 };
            for msg in &hist[start..] {
                messages.push(json!({
                    "role": msg.role,
                    "content": msg.content
                }));
            }
        }

        messages.push(json!({ "role": "user", "content": question }));

        let payload = json!({
            "model": selected_model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 1024
        });

        let response = self
            .client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", key))
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

    pub async fn transcribe_audio(
        &self,
        audio_bytes: Vec<u8>,
        file_name: &str,
        mime_type: &str,
        api_key_override: Option<&str>,
    ) -> Result<String> {
        let key = api_key_override
            .filter(|k| !k.trim().is_empty())
            .unwrap_or(&self.config.groq_api_key);

        if key.trim().is_empty() || key.contains("YOUR_GROQ_API_KEY") {
            return Err(anyhow!("GROQ_API_KEY is not configured for Whisper voice transcription."));
        }

        let part = reqwest::multipart::Part::bytes(audio_bytes)
            .file_name(file_name.to_string())
            .mime_str(mime_type)?;

        let form = reqwest::multipart::Form::new()
            .text("model", "whisper-large-v3-turbo")
            .part("file", part);

        let response = self
            .client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", key))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_text = response.text().await.unwrap_or_default();
            return Err(anyhow!("Groq Transcription API error: {}", err_text));
        }

        let json_body: Value = response.json().await?;
        let text = json_body["text"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_string();

        Ok(text)
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
                is_pinned: Some(false),
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
                is_pinned: Some(false),
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
            "Based on your local vector memory, here is what I know about your query:\n\n{}\n\n(Note: Add your GROQ_API_KEY in `.env` for AI model reasoning!)",
            fact_list.join("\n")
        )
    }
}
