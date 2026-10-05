"""Deterministic fake data so the demo looks the same on every run."""

from __future__ import annotations

import random
from dataclasses import dataclass

REGIONS = ["us-east", "us-west", "eu-central", "eu-west", "ap-south", "ap-northeast"]
STATUSES = ["healthy", "healthy", "healthy", "degraded", "down"]
OWNERS = ["platform", "payments", "search", "identity", "growth", "data", "infra"]
PREFIXES = [
    "api", "auth", "billing", "cache", "catalog", "checkout", "config", "edge",
    "events", "feed", "gateway", "inventory", "ledger", "mailer", "metrics",
    "notify", "orders", "profile", "queue", "ranker", "search", "session",
    "storage", "tracker", "upload", "users", "vault", "web",
]
SUFFIXES = ["svc", "worker", "proxy", "db", "cron", "api"]


@dataclass(frozen=True)
class Service:
    name: str
    region: str
    status: str
    cpu: float
    memory_mb: int
    uptime_h: int
    owner: str


def make_services(count: int = 120, seed: int = 42) -> list[Service]:
    rng = random.Random(seed)
    seen: set[str] = set()
    services: list[Service] = []
    while len(services) < count:
        name = f"{rng.choice(PREFIXES)}-{rng.choice(SUFFIXES)}-{rng.randint(1, 9)}"
        if name in seen:
            continue
        seen.add(name)
        status = rng.choice(STATUSES)
        services.append(
            Service(
                name=name,
                region=rng.choice(REGIONS),
                status=status,
                cpu=0.0 if status == "down" else round(rng.uniform(1, 99), 1),
                memory_mb=0 if status == "down" else rng.randint(64, 8192),
                uptime_h=0 if status == "down" else rng.randint(1, 2000),
                owner=rng.choice(OWNERS),
            )
        )
    return services


TASKS = [
    ("Rotate TLS certificates", "certs"),
    ("Upgrade Postgres to 17", "postgres"),
    ("Enable request tracing", "tracing"),
    ("Archive old logs", "logs"),
    ("Review on-call runbook", "runbook"),
    ("Bump Python dependencies", "deps"),
    ("Add rate limiting to gateway", "ratelimit"),
    ("Write postmortem for outage", "postmortem"),
    ("Tune cache eviction policy", "cache"),
    ("Migrate cron jobs to queue", "cron"),
]
