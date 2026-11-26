// Second half of the Python base project (see corpus-python.mjs).

export function pythonRest(files, app, pkg) {
  files.set(`${pkg}/validators.py`, `import re

from ${app}.errors import ValidationError

EMAIL_RE = re.compile(r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")


def require_text(field: str, value: str) -> str:
    if not value.strip():
        raise ValidationError(f"{field} must not be empty")
    return value.strip()


def require_email(value: str) -> str:
    email = require_text("email", value)
    if not EMAIL_RE.match(email):
        raise ValidationError("email format is invalid")
    return email
`);

  files.set(`${pkg}/serializers.py`, `import json
from dataclasses import asdict

from ${app}.models import Account, Invoice


def account_to_json(account: Account) -> str:
    return json.dumps(asdict(account))


def invoice_to_json(invoice: Invoice) -> str:
    return json.dumps(asdict(invoice))


def account_from_json(body: str) -> Account:
    payload = json.loads(body)
    return Account(id=payload["id"], email=payload["email"], active=payload.get("active", True))
`);

  files.set(`${pkg}/auth.py`, `from ${app}.errors import ValidationError


def bearer_token(header: str | None) -> str:
    if not header:
        raise ValidationError("missing authorization header")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ValidationError("expected a Bearer token")
    return token


def is_admin(roles: list[str]) -> bool:
    return "admin" in roles
`);

  files.set(`${pkg}/metrics.py`, `from collections import Counter


class Metrics:
    def __init__(self) -> None:
        self._counters: Counter[str] = Counter()

    def increment(self, name: str, amount: int = 1) -> None:
        self._counters[name] += amount

    def snapshot(self) -> dict[str, int]:
        return dict(self._counters)
`);

  files.set(`${pkg}/http_client.py`, `import json
from urllib.request import Request, urlopen


class HttpClient:
    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def get_json(self, path: str) -> dict[str, object]:
        request = Request(f"{self._base_url}/{path.lstrip('/')}")
        with urlopen(request, timeout=self._timeout) as response:
            return json.loads(response.read().decode("utf-8"))
`);

  files.set(`${pkg}/pagination.py`, `from dataclasses import dataclass


@dataclass(frozen=True)
class Page:
    offset: int
    limit: int

    def clamp(self, total: int) -> "Page":
        limit = min(max(self.limit, 1), 200)
        offset = min(max(self.offset, 0), total)
        return Page(offset=offset, limit=limit)

    def window(self, items: list[str]) -> list[str]:
        page = self.clamp(len(items))
        return items[page.offset : page.offset + page.limit]
`);

  files.set(`${pkg}/settings.py`, `from dataclasses import dataclass

from ${app}.config import Config


@dataclass(frozen=True)
class Settings:
    port: int
    max_batch: int

    @classmethod
    def from_config(cls, config: Config) -> "Settings":
        return cls(port=config.port, max_batch=config.max_batch)
`);

  files.set(`${pkg}/tasks.py`, `from ${app}.events import Event


def count_paid(events: list[Event]) -> int:
    return sum(1 for event in events if event.kind == "invoice.paid")
`);

  files.set(`${pkg}/events.py`, `from dataclasses import dataclass


@dataclass(frozen=True)
class Event:
    kind: str
    entity_id: str


def account_created(account_id: str) -> Event:
    return Event(kind="account.created", entity_id=account_id)


def invoice_paid(invoice_id: str) -> Event:
    return Event(kind="invoice.paid", entity_id=invoice_id)
`);

  files.set(`${pkg}/worker.py`, `from collections import deque

from ${app}.events import Event


class Worker:
    def __init__(self) -> None:
        self._queue: deque[Event] = deque()

    def submit(self, event: Event) -> None:
        self._queue.append(event)

    def drain(self) -> list[Event]:
        processed: list[Event] = []
        while self._queue:
            processed.append(self._queue.popleft())
        return processed
`);

  files.set(`${pkg}/dates.py`, `from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def is_expired(created_at: datetime, ttl_seconds: int, now: datetime | None = None) -> bool:
    current = now or utc_now()
    return (current - created_at).total_seconds() > ttl_seconds
`);

  files.set(`${pkg}/ids.py`, `import hashlib


def short_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def sequence(value: int) -> int:
    return value + 1
`);

  files.set(`${pkg}/text.py`, `def title_case(value: str) -> str:
    return " ".join(word.capitalize() for word in value.split())


def indent(level: int) -> str:
    return " " * (level * 2)
`);

  files.set(`${pkg}/retry.py`, `import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def with_retries(attempts: int, operation: Callable[[], T]) -> T:
    last_error: Exception | None = None
    for attempt in range(max(attempts, 1)):
        try:
            return operation()
        except (OSError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.01 * (attempt + 1))
    if last_error is None:
        raise RuntimeError("retry loop did not run")
    raise last_error
`);

  files.set(`${pkg}/files.py`, `from pathlib import Path


def read_lines(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_report(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
`);

  files.set(`${pkg}/registry.py`, `from collections.abc import Callable

Handler = Callable[[str], str]


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        self._handlers[name] = handler

    def dispatch(self, name: str, value: str) -> str | None:
        handler = self._handlers.get(name)
        if handler is None:
            return None
        return handler(value)
`);

  files.set(`${pkg}/health.py`, `from ${app}.metrics import Metrics


def snapshot(metrics: Metrics, cache_size: int) -> dict[str, int]:
    counters = metrics.snapshot()
    counters["cache_size"] = cache_size
    return counters
`);

  files.set('tests/test_service.py', `from ${app}.repository import AccountRepository
from ${app}.service import AccountService


def test_register_returns_account() -> None:
    service = AccountService(AccountRepository())
    account = service.register("acc-1", "ops@example.com")
    assert account.email == "ops@example.com"
`);

  files.set('tests/test_api.py', `import json

from ${app}.api import handle_request
from ${app}.repository import AccountRepository
from ${app}.service import AccountService


def test_handle_request_registers_account() -> None:
    service = AccountService(AccountRepository())
    body = json.dumps({"id": "acc-2", "email": "dev@example.com"})
    response = json.loads(handle_request(service, body))
    assert response["id"] == "acc-2"
`);

  files.set('tests/conftest.py', `import pytest

from ${app}.repository import AccountRepository
from ${app}.service import AccountService


@pytest.fixture
def service() -> AccountService:
    return AccountService(AccountRepository())
`);
}
