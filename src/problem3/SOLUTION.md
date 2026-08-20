# Problem 3 — Debugging issues within the system

## Summary

The Compose stack was unreliable because of a hard routing bug, a startup race against Postgres/Redis, and missing operational wiring (health checks, restarts, init SQL mount). Fixes make `http://localhost:8080` and `http://localhost:8080/api/users` stable after `docker compose up --build`.

## Problems found

| # | Problem | Impact |
|---|---------|--------|
| 1 | NGINX `proxy_pass` targeted `api:3001` while the API listens on `3000` | `/api/*` returned 502 / connection refused |
| 2 | `api` started as soon as containers existed, not when Postgres/Redis were ready | Intermittent 500s on first requests (`ECONNREFUSED`) |
| 3 | `postgres/init.sql` existed but was never mounted | Init settings never applied; demo DB bootstrap incomplete |
| 4 | No health checks or `restart` policies | Failed containers stayed down; NGINX could proxy to a dead API |
| 5 | `/status` not exposed via NGINX; weak proxy headers | Harder external health checks; poorer request tracing |

## How diagnosed

1. Inspected `nginx/conf.d/default.conf` vs `api/src/index.js` listen port → **port mismatch**.
2. Inspected `docker-compose.yml` `depends_on` (no `condition: service_healthy`) → **startup race**.
3. Compared `postgres/init.sql` with Compose volumes → **init script unused**.
4. Confirmed no `healthcheck` / `restart` on services → **no self-healing**.
5. Intended runtime verification: `docker compose up --build`, `docker compose ps`, `docker compose logs`, `curl -v http://localhost:8080/api/users`.

> Note: Docker was not available in the authoring environment. Fixes are based on config/code analysis matching the failure modes above; verify locally with the commands in the README.

## Fixes applied

1. **NGINX** — proxy to `http://api:3000`; expose `/status`; add standard proxy headers and timeouts.
2. **Compose** — health checks for `postgres`, `redis`, and `api`; `depends_on` with `service_healthy`; `restart: unless-stopped`; mount `init.sql`; named volume for Postgres data; explicit DB env vars.
3. **API** — env-driven DB/Redis config; safer client release in `finally`; Redis error logging without crashing the process.

## Monitoring / alerts I would add

- Synthetic check: `GET /status` and `GET /api/users` every 30–60s (NGINX + API + DB + Redis path).
- Container restart count and unhealthy status (Docker/Compose or orchestrator).
- NGINX 5xx rate and upstream connect failures.
- Postgres connection errors and Redis reconnect storms.
- Disk usage on the Docker host (ties to Problem 2 patterns).

## Production prevention

- Gate deploys on health checks (readiness before traffic).
- Use orchestrator probes (ECS/K8s) instead of bare `depends_on`.
- Centralize config via env/secrets; never rely on mismatched hard-coded ports.
- Log aggregation + alerts on 5xx and upstream failures.
- CI smoke test: `compose up` + curl against `/api/users` before merge.
- Log rotation and volume quotas for NGINX/container logs.
