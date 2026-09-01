use anyhow::Result;
use tracing::info;

pub struct EmbeddingEngine {
    dim: usize,
}

impl EmbeddingEngine {
    pub fn new() -> Self {
        info!("Initializing local Synonym-Aware 384-dimensional vector embedding engine...");
        EmbeddingEngine { dim: 384 }
    }

    pub fn embed_single(&self, text: &str) -> Result<Vec<f32>> {
        Ok(self.compute_vector(text))
    }

    pub fn compute_vector(&self, text: &str) -> Vec<f32> {
        let mut vec = vec![0.0f32; self.dim];
        let lower = text.to_lowercase();
        let tokens: Vec<&str> = lower
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .collect();

        if tokens.is_empty() {
            return vec;
        }

        // 1. Unigram feature hashing with positional decay & Synonym concept expansion
        for (pos, token) in tokens.iter().enumerate() {
            let h = hash_str(token);
            let idx = (h as usize) % self.dim;
            let sign = if (h % 2) == 0 { 1.0 } else { -1.0 };
            let position_decay = 1.0 / (1.0 + (pos as f32) * 0.1);
            vec[idx] += sign * position_decay;

            // Synonym & Concept Taxonomy Expansion
            let synonyms = get_synonyms(token);
            for syn in synonyms {
                let syn_h = hash_str(syn);
                let syn_idx = (syn_h as usize) % self.dim;
                let syn_sign = if (syn_h % 2) == 0 { 0.85 } else { -0.85 };
                vec[syn_idx] += syn_sign * position_decay;
            }
        }

        // 2. Bigram feature hashing for semantic context
        for window in tokens.windows(2) {
            let bigram = format!("{}_{}", window[0], window[1]);
            let h = hash_str(&bigram);
            let idx = (h as usize) % self.dim;
            let sign = if (h % 2) == 0 { 1.5 } else { -1.5 };
            vec[idx] += sign;
        }

        // 3. Character trigram feature hashing for subword robustness
        let chars: Vec<char> = lower.chars().collect();
        for window in chars.windows(3) {
            let trigram: String = window.iter().collect();
            let h = hash_str(&trigram);
            let idx = (h as usize) % self.dim;
            let sign = if (h % 2) == 0 { 0.5 } else { -0.5 };
            vec[idx] += sign;
        }

        // L2 Normalization for exact Cosine Similarity
        let norm_sq: f32 = vec.iter().map(|x| x * x).sum();
        let norm = norm_sq.sqrt();
        if norm > 0.0 {
            for val in vec.iter_mut() {
                *val /= norm;
            }
        }

        vec
    }
}

fn hash_str(s: &str) -> u64 {
    s.bytes().fold(5381u64, |acc, b| {
        acc.wrapping_mul(33).wrapping_add(b as u64)
    })
}

fn get_synonyms(word: &str) -> Vec<&'static str> {
    match word {
        // Tech & Devices
        "laptop" | "computer" | "pc" | "macbook" | "notebook" | "device" | "system" | "machine" => {
            vec!["laptop", "computer", "pc", "device", "hardware"]
        }
        "phone" | "mobile" | "smartphone" | "cellphone" | "call" | "number" => {
            vec!["phone", "mobile", "smartphone", "device", "communication"]
        }
        "code" | "program" | "software" | "coding" | "app" | "application" | "project" => {
            vec!["code", "program", "software", "development", "project"]
        }

        // Residence & Home (Hindi / Hinglish / English)
        "ghar" | "home" | "house" | "residence" | "flat" | "apartment" | "room" | "kamra" => {
            vec!["home", "house", "residence", "living", "place"]
        }
        "shahar" | "city" | "town" | "location" | "place" | "jagah" => {
            vec!["city", "location", "place", "area"]
        }

        // Work & Career
        "kaam" | "work" | "job" | "office" | "career" | "employment" | "naukri" | "duty" => {
            vec!["work", "job", "office", "employment", "career"]
        }

        // Finance & Money
        "paisa" | "paise" | "money" | "cash" | "salary" | "income" | "budget" | "rupee" | "rupees" | "bank" => {
            vec!["money", "finance", "cash", "salary", "wealth"]
        }

        // Relationships & People
        "dost" | "friend" | "buddy" | "pal" | "companion" | "yaar" | "mitra" => {
            vec!["friend", "companion", "person", "buddy"]
        }
        "bhai" | "brother" | "bro" | "sibling" => {
            vec!["brother", "family", "person"]
        }
        "family" | "parivar" | "parents" | "mom" | "dad" | "mummy" | "papa" => {
            vec!["family", "parents", "relatives"]
        }

        // Vehicles & Transport
        "gaadi" | "car" | "vehicle" | "bike" | "motorcycle" | "auto" | "drive" => {
            vec!["vehicle", "car", "transport", "drive"]
        }

        // Greetings & Basics
        "namaste" | "hello" | "hi" | "greetings" | "hey" => {
            vec!["greeting", "hello", "hi"]
        }

        _ => vec![],
    }
}

