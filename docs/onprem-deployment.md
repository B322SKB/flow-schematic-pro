# On-prem deployment baseline (PoC)

## Target

- Windows host with Docker Desktop, WSL 2, and Linux containers.
- Node.js 22 application container and PostgreSQL 16 database container.
- Application port 3000 inside the container.
- Host port configurable with APP_PORT (default: 3000).
- Application binds to 127.0.0.1 by default using APP_BIND_ADDRESS. Keep this
  local-only binding until editor authentication and synchronization are fully
  enabled and verified.

## Start

The Windows installer creates a local .env file containing random database
credentials, one administrator password hash, and a session signing secret. For
manual setup, populate the same values in .env before starting Compose.

From the repository root in PowerShell:

~~~powershell
docker compose build
docker compose up -d
docker compose ps
~~~

Open http://localhost:3000 (or the configured host port).

PostgreSQL data is stored in the named postgres_data volume. The initial SQL
schema is mounted into the official PostgreSQL image initialization directory
and runs only when that data volume is first created. Do not use
docker compose down -v if you need to preserve database contents.

## API

- GET /api/health: application process liveness.
- GET /api/ready: verifies PostgreSQL connectivity.
- GET/POST/DELETE /api/auth: inspect session, sign in, and sign out.
- POST /api/drawings: stores a versioned Scheme snapshot as revision 1 and
  requires an authenticated session.
- GET /api/drawings/:id: reads the current snapshot, returns revision in both
  response and ETag header, and requires an authenticated session.
- PUT /api/drawings/:id: requires a session and current revision in If-Match,
  writes a new immutable revision, and returns 409 for a stale base revision.

The editor header includes a cloud control for sign-in and manual upload/load of
the active project. Browser localStorage remains the local source of truth;
synchronization is initiated by the user.

## Operations

~~~powershell
docker compose logs -f app
docker compose logs -f db
docker compose restart app
docker compose down
~~~

To rebuild after pulling a new branch revision:

~~~powershell
docker compose down
docker compose build --no-cache
docker compose up -d
~~~

This preserves the PostgreSQL volume. The first-init SQL does not upgrade an
existing volume; schema migration tooling is needed before evolving the schema
in an installed deployment.

## Current PoC limitations

This is not yet a multi-user on-prem deployment:

- One administrator identity is configured from environment variables. There
  are no per-user accounts, drawing ownership, roles, or audit actor.
- The editor still saves in localStorage and supports only manual complete
  snapshot upload/load. It does not automatically synchronize edits.
- The HTTP-only session cookie protects the drawing API, but TLS is not included.
  Keep the port local-only until the editor is authenticated and TLS is deployed.
- No automated backups, monitoring, or production hardening is included.
- The database stores complete Scheme snapshots and supports optimistic revision
  checks, but does not model collaboration events.

Do not use this PoC for production data.

## Verification

GitHub Actions builds the Node-targeted Nitro output, runs unit tests, applies
the initial schema to PostgreSQL, exercises login/session and authenticated
drawing create/read/update plus stale revision rejection against PostgreSQL,
checks Windows package scripts, and performs an HTTP smoke test. The target
Windows machine still needs a local Docker Desktop acceptance test.
