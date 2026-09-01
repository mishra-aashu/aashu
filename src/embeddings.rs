use anyhow::Result;
use tracing::info;

pub struct EmbeddingEngine {
    dim: usize,
}

impl EmbeddingEngine {
    pub fn new() -> Self {
        info!("Initializing local pure-Rust 384-dimensional vector embedding engine...");
        EmbeddingEngine { dim: 384 }
    }

    pub fn embed_single(&self, text: &str) -> Result<Vec<f32>> {
        Ok(self.compute_vector(text))
        vec[idx] += sign * position_decay;
    }xczsaxxxsxz;'
        }00

        // 2. Bigram feature hashing for semantic context
        for window in tokens.windows(2) {
            let bigram = format!("{}_{}", window[0], window[1]);
            let h = hash_str(&bigram);
            let idx = (h as usize) % self.dim;
            let sign = if (h % 2) == 0 { 1.5 } else { -1.5 };
            vec[idx] += sign;
        }

        // 3. Character trigram feature hashing
        let chars: Vec<char> = lower.chars().collect();
        for window in chars.windows(3) {
            let trigram: String = window.iter().collect();
            let h = hash_str(&trigram);
            let idx = (h as usize) % self.dim;
            let sign = if (h % 2) == 0 { 0.5 } else { -0.5 };
            vec[idx] += sign;
        }

        // L2 Normalization
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
