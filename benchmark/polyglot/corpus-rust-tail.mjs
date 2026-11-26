// Third part of the Rust base project (see corpus-rust.mjs).

export function rustTail(rng, files, app) {
  files.set('src/report.rs', `use crate::model::Invoice;

pub struct Report {
    pub invoices: Vec<Invoice>,
}

impl Report {
    pub fn total_cents(&self) -> i64 {
        self.invoices.iter().map(Invoice::total).sum()
    }

    pub fn by_currency(&self) -> Vec<(String, i64)> {
        let mut totals: Vec<(String, i64)> = Vec::new();
        for invoice in &self.invoices {
            match totals
                .iter_mut()
                .find(|(currency, _)| currency == &invoice.currency)
            {
                Some((_, total)) => *total += invoice.total(),
                None => totals.push((invoice.currency.clone(), invoice.total())),
            }
        }
        totals
    }
}
`);

  files.set('src/state.rs', `use crate::cache::Cache;
use crate::metrics::Metrics;

pub struct AppState {
    pub cache: Cache,
    pub metrics: Metrics,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            cache: Cache::default(),
            metrics: Metrics::default(),
        }
    }

    pub fn record(&mut self, name: &str) {
        self.metrics.increment(name);
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
`);

  files.set('src/feature_flags.rs', `use std::collections::HashMap;

#[derive(Default)]
pub struct FeatureFlags {
    values: HashMap<String, bool>,
}

impl FeatureFlags {
    pub fn set(&mut self, name: &str, enabled: bool) {
        self.values.insert(name.to_string(), enabled);
    }

    pub fn enabled(&self, name: &str) -> bool {
        self.values.get(name).copied().unwrap_or(false)
    }
}
`);

  files.set('src/pagination.rs', `pub struct Page {
    pub offset: usize,
    pub limit: usize,
}

impl Page {
    pub fn new(offset: usize, limit: usize) -> Self {
        Self {
            offset,
            limit: limit.clamp(1, 200),
        }
    }

    pub fn slice<'a, T>(&self, items: &'a [T]) -> &'a [T] {
        let start = self.offset.min(items.len());
        let end = (start + self.limit).min(items.len());
        &items[start..end]
    }
}
`);

  files.set('src/retry.rs', `use std::thread;
use std::time::Duration;

pub fn with_retries<F, T, E>(attempts: u32, mut operation: F) -> Result<T, E>
where
    F: FnMut() -> Result<T, E>,
{
    let mut last_error = None;
    for attempt in 0..attempts.max(1) {
        match operation() {
            Ok(value) => return Ok(value),
            Err(err) => {
                last_error = Some(err);
                thread::sleep(Duration::from_millis(u64::from(attempt + 1) * 10));
            }
        }
    }
    match last_error {
        Some(err) => Err(err),
        None => unreachable!(),
    }
}
`);

  files.set('src/text.rs', `pub fn title_case(input: &str) -> String {
    input
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn indent(level: usize) -> String {
    " ".repeat(level * 2)
}
`);

  files.set('tests/store_test.rs', `use ${app}_core::model::Account;
use ${app}_core::store::AccountStore;

#[test]
fn inserts_and_finds_accounts() {
    let mut store = AccountStore::new();
    let account = Account {
        id: "acc-1".to_string(),
        email: "ops@example.com".to_string(),
        active: true,
    };
    store.insert(account).unwrap();
    let found = store.find("acc-1").unwrap();
    assert_eq!(found.email, "ops@example.com");
}
`);

  files.set('tests/api_test.rs', `use ${app}_core::api::{parse_account, serialize_account};

#[test]
fn round_trips_accounts() {
    let body = r#"{"id":"acc-1","email":"ops@example.com","active":true}"#;
    let account = parse_account(body).unwrap();
    let encoded = serialize_account(&account).unwrap();
    assert!(encoded.contains("ops@example.com"));
}
`);

  files.set('benches/parse.rs', `use std::time::Instant;

fn main() {
    let line = "inv-1,acc-1,1250";
    let start = Instant::now();
    for _ in 0..1_000 {
        let parts = line.split(',').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
    }
    println!("elapsed: {:?}", start.elapsed());
}
`);

  files.set('examples/demo.rs', `fn main() {
    let path = std::env::args().nth(1).unwrap();
    let body = std::fs::read_to_string(path).unwrap();
    println!("{} bytes", body.len());
}
`);
}
