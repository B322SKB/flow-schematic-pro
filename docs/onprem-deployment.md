# On-prem deployment baseline (PoC)

## Target

- Windows host with Docker Desktop and WSL2.
- Docker Desktop configured for Linux containers.
- Node.js 22 runtime inside the application image.
- Application listens on port 3000 inside the container.
- The host port is configurable with `APP_PORT` (default: 3000).

## Start

From the repository root in PowerShell:

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost:3000` (or the configured host port).

## Operations

```powershell
docker compose logs -f app
docker compose restart app
docker compose down
```

To rebuild after pulling a new branch revision:

```powershell
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Current PoC limitations — important

This is only the containerized application runtime. It is **not yet a multi-user on-prem deployment**:

- Projects are still persisted in each browser's local storage.
- There is no application API, authentication, central PostgreSQL persistence, revision history service or collaboration channel yet.
- The Compose file intentionally does not start PostgreSQL until the application has a database-backed service and migrations to use it.
- No TLS reverse proxy, automated backup, monitoring, or production hardening is included.
- The HTTP health check verifies that the application root responds; it does not prove database or engineering-service health.

Do not use this baseline for production data or expose it directly to the public internet. The next implementation increment must add server-side configuration validation, a PostgreSQL connection/migration layer, and an API health/readiness endpoint before the database service is added to Compose.

## Verification

GitHub Actions builds the Node-targeted Nitro output, checks for `.output/server/index.mjs`, starts it with Node 22, and performs an HTTP smoke test against the root route. The target Windows machine still needs a local Docker Desktop acceptance test.
