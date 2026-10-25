# Windows installation package (PoC)

This downloadable ZIP starts P&ID Flow Pro and PostgreSQL on a Windows host
through Docker Desktop and Docker Compose v2. It is a source-and-deployment
bundle, not a standalone Windows executable.

## Requirements

- Windows 10/11 with WSL 2 enabled.
- Docker Desktop configured for Linux containers, with its engine running.
- A free host TCP port (default: 3000).

## Install

1. Download the `pid-flow-pro-windows-onprem` artifact from the latest successful
   **CI** run on branch `feature/pid-onprem-poc`.
2. Extract the ZIP to a writable folder where you want to keep the application
   files and generated `.env` secret.
3. Open PowerShell in the extracted folder.
4. Run:

   ```powershell
   .\deploy\windows\install.ps1
   ```

   To use a different port, pass it explicitly:

   ```powershell
   .\deploy\windows\install.ps1 -Port 3080
   ```

5. The script creates a random PostgreSQL password in `.env` if needed, builds
   the Linux containers locally, starts the application and database, and opens
   the browser at `http://localhost:<port>`. Use `-NoOpen` to skip opening the
   browser.

The installer checks that Docker Desktop and Compose are available and that the
Docker engine is running. It does not download or install Docker Desktop. Keep
the extracted folder and its `.env` file while you keep the PostgreSQL data.

## Direct Compose setup

If running Compose manually, copy `.env.example` to `.env`, replace
`POSTGRES_PASSWORD` with a random secret, then run:

```powershell
docker compose up -d --build
docker compose ps
```

The Compose port binds to `127.0.0.1` by default. Do not expose it to a LAN
before authentication and access control are implemented.

## Stop and remove the containers

Run this from the extracted folder:

```powershell
.\deploy\windows\uninstall.ps1
```

This stops and removes the Compose containers but preserves the database volume,
image, `.env` credentials, and browser data. Do not delete the extracted folder
or `.env` if you need the database volume later.

## Current PoC limits

- The PostgreSQL API supports creating a drawing snapshot, reading it, and
  updating it with an `If-Match` revision check. Stale updates are rejected.
- The editor UI still saves its projects in each browser's localStorage and is
  not yet synchronized with the PostgreSQL API. Accounts, authentication,
  authorization, and multi-user editing are not implemented.
- The initial SQL schema runs automatically only when PostgreSQL initializes a
  new data volume. A migration management/upgrade process is not yet included.
- No TLS, automated backup, monitoring, or production hardening is included.
- CI checks PowerShell syntax and package contents, builds/smoke-tests the
  Node container, and runs the API against a PostgreSQL service. Docker Desktop
  has not been exercised on a Windows host in this task; perform that acceptance
  check on the target machine before relying on it.

For service details and current risks, see
[onprem-deployment.md](onprem-deployment.md).
