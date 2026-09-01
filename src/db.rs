use anyhow::{Context, Result};
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use tracing::info;

use crate::models::FactItem;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self> {
        info!("Opening SQLite database at {}", db_path);
        let conn = Connection::open(db_path)
            .with_context(|| format!("Failed to open SQLite DB at {}", db_path))?;

        // Register custom vector cosine_similarity function in SQLite
        conn.create_scalar_function(
            "cosine_similarity",
            2,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let blob1 = ctx.get_raw(0).as_blob()?;
                let blob2 = ctx.get_raw(1).as_blob()?;

                let v1 = bytes_to_f32_slice(blob1);
                let v2 = bytes_to_f32_slice(blob2);

                if v1.is_empty() || v1.len() != v2.len() {
                    return Ok(0.0f64);
                }

                let mut dot = 0.0f32;
                let mut norm_a = 0.0f32;
                let mut norm_b = 0.0f32;

                for i in 0..v1.len() {
                    dot += v1[i] * v2[i];
                    norm_a += v1[i] * v1[i];
                    norm_b += v2[i] * v2[i];
                }

                if norm_a == 0.0 || norm_b == 0.0 {
                    return Ok(0.0f64);
                }

                let sim = dot / (norm_a.sqrt() * norm_b.sqrt());
                Ok(sim as f64)
            },
        )?;

        // Create table schema if not exists
        conn.execute(
            "CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact TEXT NOT NULL,
                category TEXT,
                date TEXT,
                embedding BLOB NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Create settings table schema if not exists
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Database {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn insert_fact(&self, fact: &FactItem, embedding: &[f32]) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let embedding_bytes = f32_slice_to_bytes(embedding);

        conn.execute(
            "INSERT INTO facts (fact, category, date, embedding) VALUES (?1, ?2, ?3, ?4)",
            params![
                fact.fact,
                fact.category.as_deref().unwrap_or("General"),
                fact.date.as_deref().unwrap_or("N/A"),
                embedding_bytes
            ],
        )?;

        let id = conn.last_insert_rowid();
        Ok(id)
    }

    pub fn search_similar_facts(&self, query_embedding: &[f32], top_k: usize) -> Result<Vec<FactItem>> {
        let conn = self.conn.lock().unwrap();
        let query_bytes = f32_slice_to_bytes(query_embedding);

        let mut stmt = conn.prepare(
            "SELECT id, fact, category, date, cosine_similarity(?1, embedding) AS score
             FROM facts
             ORDER BY score DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![query_bytes, top_k as i64], |row| {
            let id: i64 = row.get(0)?;
            let fact: String = row.get(1)?;
            let category: Option<String> = row.get(2)?;
            let date: Option<String> = row.get(3)?;
            let score: f64 = row.get(4)?;

            Ok(FactItem {
                id: Some(id),
                fact,
                category,
                date,
                score: Some(score as f32),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }

    pub fn get_all_facts(&self) -> Result<Vec<FactItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, fact, category, date FROM facts ORDER BY id DESC")?;

        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let fact: String = row.get(1)?;
            let category: Option<String> = row.get(2)?;
            let date: Option<String> = row.get(3)?;

            Ok(FactItem {
                id: Some(id),
                fact,
                category,
                date,
                score: None,
            })
        })?;

        let mut facts = Vec::new();
        for row in rows {
            facts.push(row?);
        }

        Ok(facts)
    }

    pub fn delete_fact(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM facts WHERE id = ?1", params![id])?;
        Ok(count > 0)
    }

    pub fn get_facts_count(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM facts", [], |r| r.get(0))?;
        Ok(count as usize)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get(0))?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn reset_all_data(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM facts", [])?;
        conn.execute("DELETE FROM settings", [])?;
        Ok(())
    }
}

fn f32_slice_to_bytes(slice: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(slice.len() * 4);
    for &val in slice {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

fn bytes_to_f32_slice(bytes: &[u8]) -> Vec<f32> {
    if bytes.len() % 4 != 0 {
        return Vec::new();
    }
    let mut slice = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let arr: [u8; 4] = chunk.try_into().unwrap_or([0, 0, 0, 0]);
        slice.push(f32::from_le_bytes(arr));
    }
    slice
}
