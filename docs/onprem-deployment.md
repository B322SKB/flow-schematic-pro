# On-prem deployment baseline (PoC)

## Target

- Windows host with Docker Desktop, WSL 2, and Linux containers.
- Node.js 22 application container and PostgreSQL 16 database container.
- Application port 3000 inside the container.
- Host port configurable with `APP_PORT` (default: 3000).
- Application binds to `127.0.0.1` by default using `APP_BIND_ADDRESS`. Keep
  that local-only binding until authentication and authorization are implemented.

## Start

The Windows installer creates a random PostgreSQL password in a local `.env`
file. For manual setup, first copy `.env.example` to `.env` and set a random
`POSTGRES_PASSWORD`.

From the repository root in PowerShell:

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost:3000` (or the configured host port).

PostgreSQL data is stored in the named `postgres_data` volume. The initial SQL
schema is mounted into the official PostgreSQL image's initialization directory
and runs only when that data volume is first created. Do not use
`docker compose down -v` if you need to preserve database contents.

## API

- `GET /api/health`: application process liveness.
- `GET /api/ready`: verifies PostgreSQL connectivity.
- `POST /api/drawings`: stores a versioned Scheme snapshot as revision 1.
- `GET /api/drawings/:id`: reads the current snapshot; returns the revision in
  both the response and `ETag` header.
- `PUT /api/drawings/:id`: requires the current revision in `If-Match`, writes
  a new immutable revision, and returns 409 for a stale base revision.

The API is not connected to the editor UI yet. Browser `localStorage` remains
the app's user-facing source of truth.

## Operations

```powershell
docker compose logs -f app
docker compose logs -f db
docker compose restart app
docker compose down
```

To rebuild after pulling a new branch revision:

```powershell
docker compose down
docker compose build --no-cache
docker compose up -d
```

This preserves the PostgreSQL volume. The first-init SQL does not upgrade an
existing volume; schema migration tooling is still needed before evolving the
database schema in an installed deployment.

## Current PoC limitations

This is not yet a multi-user on-prem deployment:

- The API has no accounts, authentication, authorization, or audit actor.
- The editor still saves its projects in browser localStorage and does not sync
  to the PostgreSQL API.
- The container port binds to localhost by default. Do not expose the API to a
  LAN or public network until access control and a deployment-specific security
  review exist.
- No TLS reverse proxy, automated backups, monitoring, or production hardening
  is included.
- The database API stores complete Scheme snapshots and supports optimistic
  revision checks; it does not yet model project membership or collaboration
  events.

Do not use this PoC for production data.

## Verification

GitHub Actions builds the Node-targeted Nitro output, runs unit tests, applies
the initial schema to PostgreSQL, exercises drawing create/read/update and stale
revision rejection against a PostgreSQL service, checks the Windows package
scripts, and performs an HTTP smoke test. The target Windows machine still needs
a local Docker Desktop acceptance test.
