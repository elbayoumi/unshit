// Deterministic, idiomatic Python project for the polyglot recall benchmark.
// The base is clean for `python/no-bare-except`: every handler catches a
// specific exception. `tests/` and `conftest.py` are included on purpose to
// exercise the detector's test-path exclusion.

import { pick } from './lib.mjs';
import { pythonRest } from './corpus-python-rest.mjs';

export function pythonFiles(rng, files) {
  const app = pick(rng, ['ledger', 'atlas', 'harbor', 'summit']);
  const defaultPort = 7000 + Math.floor(rng() * 2000);
  const batch = 50 + Math.floor(rng() * 150);
  const pkg = `src/${app}`;

  files.set('pyproject.toml', `[project]
name = "${app}-service"
version = "0.4.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["tests"]
`);

  files.set(`${pkg}/__init__.py`, `"""${app} service package."""

from ${app}.models import Account, Invoice

__all__ = ["Account", "Invoice"]
`);

  files.set(`${pkg}/config.py`, `from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Config:
    port: int
    max_batch: int
    data_dir: str

    @classmethod
    def from_env(cls) -> "Config":
        port = int(os.environ.get("PORT", "${defaultPort}"))
        max_batch = int(os.environ.get("MAX_BATCH", "${batch}"))
        data_dir = os.environ.get("DATA_DIR", "./data")
        if not data_dir:
            raise ValueError("DATA_DIR must not be empty")
        return cls(port=port, max_batch=max_batch, data_dir=data_dir)
`);

  files.set(`${pkg}/models.py`, `from dataclasses import dataclass


@dataclass(frozen=True)
class Account:
    id: str
    email: str
    active: bool = True


@dataclass(frozen=True)
class Invoice:
    id: str
    account_id: str
    amount_cents: int
    currency: str = "USD"

    @property
    def amount(self) -> float:
        return self.amount_cents / 100
`);

  files.set(`${pkg}/errors.py`, `class LedgerError(Exception):
    """Base error for the service."""


class ValidationError(LedgerError):
    """Raised when input does not satisfy the domain rules."""


class NotFoundError(LedgerError):
    """Raised when a requested entity does not exist."""
`);

  files.set(`${pkg}/repository.py`, `from collections.abc import Iterable

from ${app}.models import Account


class AccountRepository:
    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}

    def add(self, account: Account) -> None:
        if account.id in self._accounts:
            raise ValueError(f"duplicate account: {account.id}")
        self._accounts[account.id] = account

    def get(self, account_id: str) -> Account | None:
        return self._accounts.get(account_id)

    def active(self) -> Iterable[Account]:
        return (account for account in self._accounts.values() if account.active)

    def save(self, account: Account) -> None:
        self._accounts[account.id] = account
`);

  files.set(`${pkg}/service.py`, `from dataclasses import replace

from ${app}.errors import NotFoundError, ValidationError
from ${app}.models import Account
from ${app}.repository import AccountRepository


class AccountService:
    def __init__(self, repository: AccountRepository) -> None:
        self._repository = repository

    def register(self, account_id: str, email: str) -> Account:
        if "@" not in email:
            raise ValidationError("email is missing @")
        account = Account(id=account_id, email=email)
        self._repository.add(account)
        return account

    def deactivate(self, account_id: str) -> Account:
        account = self._repository.get(account_id)
        if account is None:
            raise NotFoundError(account_id)
        updated = replace(account, active=False)
        self._repository.save(updated)
        return updated

    def count_active(self) -> int:
        return sum(1 for _ in self._repository.active())
`);

  files.set(`${pkg}/api.py`, `import json

from ${app}.service import AccountService


def handle_request(service: AccountService, body: str) -> str:
    payload = json.loads(body)
    account_id = payload.get("id")
    email = payload.get("email", "")
    if not isinstance(account_id, str):
        return json.dumps({"error": "id must be a string"})
    account = service.register(account_id, email)
    return json.dumps({"id": account.id, "email": account.email})
`);

  files.set(`${pkg}/cli.py`, `import argparse

from ${app}.config import Config
from ${app}.repository import AccountRepository
from ${app}.service import AccountService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="${app}")
    parser.add_argument("--port", type=int, default=Config.from_env().port)
    return parser


def run(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    service = AccountService(AccountRepository())
    service.register("acc-1", "ops@example.com")
    print(f"listening on {args.port}")
    return 0
`);

  files.set(`${pkg}/logging_setup.py`, `import logging


def configure(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
`);

  files.set(`${pkg}/utils.py`, `import re
import unicodedata


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")


def truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"
`);

  files.set(`${pkg}/cache.py`, `from time import monotonic


class TTLCache:
    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._items: dict[str, tuple[float, str]] = {}

    def get(self, key: str) -> str | None:
        entry = self._items.get(key)
        if entry is None:
            return None
        created_at, value = entry
        if monotonic() - created_at > self._ttl:
            self._items.pop(key, None)
            return None
        return value

    def put(self, key: str, value: str) -> None:
        self._items[key] = (monotonic(), value)
`);

  files.set(`${pkg}/scheduler.py`, `from collections.abc import Callable
from dataclasses import dataclass, field
from time import monotonic


@dataclass
class Job:
    name: str
    interval: float
    action: Callable[[], None]
    last_run: float = field(default_factory=monotonic)


class Scheduler:
    def __init__(self) -> None:
        self._jobs: list[Job] = []

    def add(self, job: Job) -> None:
        self._jobs.append(job)

    def tick(self, now: float | None = None) -> int:
        current = monotonic() if now is None else now
        ran = 0
        for job in self._jobs:
            if current - job.last_run >= job.interval:
                job.action()
                job.last_run = current
                ran += 1
        return ran
`);
  pythonRest(files, app, pkg);
}
