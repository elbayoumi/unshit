// Deterministic, idiomatic Rust project used by the polyglot recall benchmark.
// The base is deliberately clean for the tracked rules: no `.unwrap()` outside
// test/bench/example/build paths, and no `#[cfg(test)]` blocks in `src/`.
//
// `tests/`, `benches/`, `examples/` and `build.rs` are part of the base on
// purpose: they exercise the detector's documented test-path exclusions.

import { pick } from './lib.mjs';
import { rustRest } from './corpus-rust-rest.mjs';
import { rustTail } from './corpus-rust-tail.mjs';

export function rustFiles(rng, files) {
  const app = pick(rng, ['ledger', 'atlas', 'harbor', 'summit']);
  const port = 7000 + Math.floor(rng() * 2000);
  const maxBatch = 50 + Math.floor(rng() * 150);

  files.set('Cargo.toml', `[package]
name = "${app}-core"
version = "0.4.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
tempfile = "3"
`);

  files.set('build.rs', `use std::env;

fn main() {
    let target = env::var("TARGET").unwrap();
    println!("cargo:rustc-env=BUILD_TARGET={target}");
}
`);

  files.set('src/main.rs', `mod cli;
mod config;
mod error;

use std::process::ExitCode;

fn main() -> ExitCode {
    let config = match config::Config::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("configuration error: {err}");
            return ExitCode::FAILURE;
        }
    };

    match cli::run(config) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}
`);

  files.set('src/lib.rs', `pub mod api;
pub mod auth;
pub mod cache;
pub mod cli;
pub mod config;
pub mod env;
pub mod error;
pub mod feature_flags;
pub mod format;
pub mod handlers;
pub mod ids;
pub mod logging;
pub mod metrics;
pub mod model;
pub mod pagination;
pub mod parser;
pub mod queue;
pub mod report;
pub mod retry;
pub mod routes;
pub mod service;
pub mod state;
pub mod store;
pub mod text;
pub mod time;
pub mod util;
pub mod validation;
pub mod worker;

pub use error::AppError;
pub use model::{Account, Invoice};
`);

  files.set('src/error.rs', `use std::fmt;
use std::io;

#[derive(Debug)]
pub enum AppError {
    Io(io::Error),
    Config(String),
    Validation(String),
    NotFound(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "io error: {err}"),
            Self::Config(message) => write!(f, "config error: {message}"),
            Self::Validation(message) => write!(f, "invalid input: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}
`);

  files.set('src/config.rs', `use std::env;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub max_batch: usize,
    pub data_dir: String,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(${port});
        let max_batch = env::var("MAX_BATCH")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(${maxBatch});
        let data_dir = env::var("DATA_DIR").unwrap_or_else(|_| "./data".to_string());
        if data_dir.is_empty() {
            return Err(AppError::Config("DATA_DIR must not be empty".into()));
        }
        Ok(Self { port, max_batch, data_dir })
    }
}
`);

  files.set('src/model.rs', `use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub account_id: String,
    pub amount_cents: i64,
    pub currency: String,
}

impl Invoice {
    pub fn total(&self) -> i64 {
        self.amount_cents
    }
}
`);

  files.set('src/store.rs', `use crate::error::AppError;
use crate::model::Account;

#[derive(Default)]
pub struct AccountStore {
    accounts: Vec<Account>,
}

impl AccountStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, account: Account) -> Result<(), AppError> {
        if account.email.trim().is_empty() {
            return Err(AppError::Validation("email must not be empty".into()));
        }
        if self.accounts.iter().any(|item| item.email == account.email) {
            return Err(AppError::Validation("email already registered".into()));
        }
        self.accounts.push(account);
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|account| account.id == id)
    }

    pub fn replace(&mut self, account: Account) -> Result<(), AppError> {
        match self.accounts.iter_mut().find(|item| item.id == account.id) {
            Some(slot) => {
                *slot = account;
                Ok(())
            }
            None => Err(AppError::NotFound(account.id)),
        }
    }

    pub fn active(&self) -> impl Iterator<Item = &Account> {
        self.accounts.iter().filter(|account| account.active)
    }
}
`);

  files.set('src/service.rs', `use crate::error::AppError;
use crate::model::Account;
use crate::store::AccountStore;

pub struct AccountService {
    store: AccountStore,
}

impl AccountService {
    pub fn new(store: AccountStore) -> Self {
        Self { store }
    }

    pub fn register(&mut self, id: &str, email: &str) -> Result<&Account, AppError> {
        let account = Account {
            id: id.to_string(),
            email: email.to_string(),
            active: true,
        };
        self.store.insert(account)?;
        self.store
            .find(id)
            .ok_or_else(|| AppError::NotFound(id.to_string()))
    }

    pub fn deactivate(&mut self, id: &str) -> Result<(), AppError> {
        let mut account = self
            .store
            .find(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(id.to_string()))?;
        account.active = false;
        self.store.replace(account)
    }

    pub fn count(&self) -> usize {
        self.store.active().count()
    }
}
`);

  files.set('src/parser.rs', `use crate::error::AppError;
use crate::model::Invoice;

pub fn parse_invoice(line: &str) -> Result<Invoice, AppError> {
    let mut parts = line.split(',');
    let id = parts
        .next()
        .ok_or_else(|| AppError::Validation("missing id".into()))?;
    let account_id = parts
        .next()
        .ok_or_else(|| AppError::Validation("missing account".into()))?;
    let amount = parts
        .next()
        .ok_or_else(|| AppError::Validation("missing amount".into()))?;
    let amount_cents = amount
        .trim()
        .parse::<i64>()
        .map_err(|_| AppError::Validation(format!("invalid amount: {amount}")))?;
    Ok(Invoice {
        id: id.trim().to_string(),
        account_id: account_id.trim().to_string(),
        amount_cents,
        currency: "USD".to_string(),
    })
}
`);

  files.set('src/cli.rs', `use crate::config::Config;
use crate::error::AppError;
use crate::service::AccountService;
use crate::store::AccountStore;

pub fn run(config: Config) -> Result<(), AppError> {
    let mut service = AccountService::new(AccountStore::new());
    println!("starting on port {}", config.port);
    let _account = service.register("acc-1", "ops@example.com")?;
    println!("{} active accounts", service.count());
    Ok(())
}
`);

  files.set('src/util.rs', `pub fn slugify(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

pub fn truncate(input: &str, limit: usize) -> &str {
    match input.char_indices().nth(limit) {
        Some((index, _)) => &input[..index],
        None => input,
    }
}
`);

  files.set('src/metrics.rs', `use std::collections::BTreeMap;

#[derive(Default)]
pub struct Metrics {
    counters: BTreeMap<String, u64>,
}

impl Metrics {
    pub fn increment(&mut self, name: &str) {
        *self.counters.entry(name.to_string()).or_insert(0) += 1;
    }

    pub fn snapshot(&self) -> &BTreeMap<String, u64> {
        &self.counters
    }
}
`);
  rustRest(rng, files, app);
  rustTail(rng, files, app);
}
