// Second half of the Rust base project (see corpus-rust.mjs).

export function rustRest(rng, files, app) {
  files.set('src/validation.rs', `use crate::error::AppError;

pub fn require_non_empty(field: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} must not be empty")));
    }
    Ok(())
}

pub fn require_email(value: &str) -> Result<(), AppError> {
    require_non_empty("email", value)?;
    if !value.contains('@') {
        return Err(AppError::Validation("email is missing @".into()));
    }
    Ok(())
}
`);

  files.set('src/routes.rs', `#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Health,
    Accounts,
    Invoices,
    NotFound(String),
}

pub fn parse(path: &str) -> Route {
    match path.trim_end_matches('/') {
        "/health" => Route::Health,
        "/accounts" => Route::Accounts,
        "/invoices" => Route::Invoices,
        other => Route::NotFound(other.to_string()),
    }
}
`);

  files.set('src/handlers.rs', `use crate::routes::Route;
use crate::service::AccountService;

pub fn handle(route: &Route, service: &mut AccountService) -> String {
    match route {
        Route::Health => "ok".to_string(),
        Route::Accounts => format!("{} accounts", service.count()),
        Route::Invoices => "invoices".to_string(),
        Route::NotFound(path) => format!("no route for {path}"),
    }
}
`);

  files.set('src/auth.rs', `use crate::error::AppError;

pub fn bearer_token(header: Option<&str>) -> Result<&str, AppError> {
    let value = header.ok_or_else(|| AppError::Validation("missing authorization".into()))?;
    value
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Validation("expected Bearer token".into()))
}

pub fn is_admin(roles: &[String]) -> bool {
    roles.iter().any(|role| role == "admin")
}
`);

  files.set('src/cache.rs', `use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Clone, Default)]
pub struct Cache {
    inner: Arc<RwLock<HashMap<String, String>>>,
}

impl Cache {
    pub fn get(&self, key: &str) -> Option<String> {
        match self.inner.read() {
            Ok(guard) => guard.get(key).cloned(),
            Err(poisoned) => poisoned.into_inner().get(key).cloned(),
        }
    }

    pub fn put(&self, key: &str, value: String) {
        match self.inner.write() {
            Ok(mut guard) => {
                guard.insert(key.to_string(), value);
            }
            Err(poisoned) => {
                poisoned.into_inner().insert(key.to_string(), value);
            }
        }
    }
}
`);

  files.set('src/worker.rs', `use std::thread;
use std::time::Duration;

use crate::error::AppError;
use crate::queue::Queue;

pub fn drain(queue: Queue) -> Result<usize, AppError> {
    let mut processed = 0;
    while let Some(job) = queue.pop() {
        if job.is_empty() {
            return Err(AppError::Validation("empty job".into()));
        }
        processed += 1;
        thread::sleep(Duration::from_millis(5));
    }
    Ok(processed)
}
`);

  files.set('src/queue.rs', `use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct Queue {
    items: Arc<Mutex<VecDeque<String>>>,
}

impl Queue {
    pub fn push(&self, job: String) {
        if let Ok(mut items) = self.items.lock() {
            items.push_back(job);
        }
    }

    pub fn pop(&self) -> Option<String> {
        match self.items.lock() {
            Ok(mut items) => items.pop_front(),
            Err(poisoned) => poisoned.into_inner().pop_front(),
        }
    }
}
`);

  files.set('src/format.rs', `pub fn cents_to_display(cents: i64, currency: &str) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = cents.abs();
    format!("{sign}{}.{:02} {currency}", absolute / 100, absolute % 100)
}

pub fn percent(value: f64, total: f64) -> String {
    if total <= 0.0 {
        return "0.0%".to_string();
    }
    format!("{:.1}%", (value / total) * 100.0)
}
`);

  files.set('src/time.rs', `use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_millis() -> u128 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    }
}

pub fn is_expired(created_at: u128, ttl_ms: u128, now: u128) -> bool {
    now.saturating_sub(created_at) > ttl_ms
}
`);

  files.set('src/ids.rs', `use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub fn short_id(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

pub fn next_sequence(current: u64) -> u64 {
    current.wrapping_add(1)
}
`);

  files.set('src/env.rs', `use std::env;

pub fn flag(name: &str) -> bool {
    matches!(env::var(name).as_deref(), Ok("1") | Ok("true") | Ok("yes"))
}

pub fn number(name: &str, fallback: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}
`);

  files.set('src/logging.rs', `pub fn log_line(level: &str, message: &str) -> String {
    format!("[{level}] {message}")
}

pub fn redact(token: &str) -> String {
    if token.len() <= 4 {
        return "*".repeat(token.len());
    }
    format!("{}***", &token[..2])
}
`);

  files.set('src/api.rs', `use crate::error::AppError;
use crate::model::Account;

pub fn serialize_account(account: &Account) -> Result<String, AppError> {
    serde_json::to_string(account).map_err(|err| AppError::Validation(err.to_string()))
}

pub fn parse_account(body: &str) -> Result<Account, AppError> {
    serde_json::from_str(body).map_err(|err| AppError::Validation(err.to_string()))
}
`);
}
