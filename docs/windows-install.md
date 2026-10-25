# Windows installation package (PoC)

This downloadable ZIP starts P&ID Flow Pro and PostgreSQL on a Windows host
through Docker Desktop and Docker Compose v2. It is a source-and-deployment
bundle, not a standalone Windows executable.

## Requirements

- Windows 10/11 with WSL 2 enabled.
- Docker Desktop configured for Linux containers, with its engine running.
- A free host TCP port (default: 3000).

## Install

1. Download the pid-flow-pro-windows-onprem artifact from the latest successful
   CI run on branch feature/pid-onprem-poc.
2. Extract the ZIP to a writable folder where application files, generated
   administrator credentials, and database secrets will remain.
3. Open PowerShell in the extracted folder.
4. Run:

   ~~~powershell
   .\deploy\windows\install.ps1
   ~~~

   To use a different port, pass it explicitly:

   ~~~powershell
   .\deploy\windows\install.ps1 -Port 3080
   ~~~

5. On first install, the script creates a random database password, one-time
   administrator password, PBKDF2 password hash, and session signing secret in
   .env. Save the administrator password printed by the script. It is not stored
   in plaintext. The script builds containers, starts application and database,
   and opens the browser at http://localhost:<port>. Use -NoOpen to skip opening.

The installer checks for Docker Desktop, Compose, and a running Docker engine. It
does not download or install Docker Desktop. Keep the extracted folder and .env
file while you keep the PostgreSQL data.

## Authentication

GET/POST/DELETE /api/auth reads the session, signs in, and signs out. Drawing
create/read/update endpoints require the HTTP-only, SameSite=Strict,
eight-hour session cookie. This PoC configures one administrator identity;
per-user accounts, drawing ownership, and team permissions are not implemented.
Keep the service bound to 127.0.0.1.

## Direct Compose setup

For manual deployment, populate .env with a PostgreSQL password, administrator
email, PBKDF2-SHA256 password hash, and at least 32 random bytes for
PID_SESSION_SECRET. The Windows installer can generate these values safely;
then run:

~~~powershell
docker compose up -d --build
docker compose ps
~~~

## Stop and remove the containers

Run this from the extracted folder:

~~~powershell
.\deploy\windows\uninstall.ps1
~~~

This stops and removes containers but preserves database volume, image, .env
credentials, and browser data. Keep the extracted folder and .env to retain the
database volume.

## Current PoC limits

- The editor UI still saves projects in browser localStorage and is not yet
  synchronized with the PostgreSQL API.
- The configured administrator login protects drawing API endpoints. It does not
  implement multiple accounts, per-user drawing ownership, project sharing, or
  live multi-user editing.
- The initial SQL schema runs automatically only when PostgreSQL initializes a
  new data volume. A migration management/upgrade process is not yet included.
- No TLS, automated backup, monitoring, or production hardening is included.
- CI tests the Node server, PostgreSQL API/authentication, PowerShell syntax, and
  package contents. Docker Desktop has not been exercised on a Windows host in
  this task; perform that acceptance check on the target machine before relying
  on it.

See onprem-deployment.md for service details and risks.
