# Windows installation package (PoC)

This ZIP bundle starts the current P&ID Flow Pro web application on a Windows
host using Docker Desktop and Docker Compose v2. It is a source-and-deployment
bundle, not a standalone Windows executable.

## Requirements

- Windows 10/11 with WSL 2 enabled.
- Docker Desktop configured to use Linux containers, with its engine running.
- A free host TCP port (default: 3000).

## Install

1. Download the `pid-flow-pro-windows-onprem` artifact from the latest successful
   **CI** run on branch `feature/pid-onprem-poc`.
2. Extract the ZIP to a folder where you want to keep the application files.
3. Open PowerShell in the extracted folder.
4. Run:

   ```powershell
   .\deploy\windows\install.ps1
   ```

   To use a different port, pass it explicitly:

   ```powershell
   .\deploy\windows\install.ps1 -Port 3080
   ```

5. The script builds the Linux container locally, starts the Compose service,
   and opens the browser at `http://localhost:<port>`. Use `-NoOpen` to skip
   opening the browser.

The installer checks that Docker Desktop and Compose are available and that the
Docker engine is running. It does not download or install Docker Desktop.

## Stop and remove the application container

Run this from the extracted folder:

```powershell
.\deploy\windows\uninstall.ps1
```

This stops and removes the Compose container but leaves the image and any Docker
volumes intact. Delete the extracted folder separately if you no longer need it.

## Current PoC limits

- The application still stores projects in each browser's localStorage.
- The PostgreSQL schema is only a draft; this package does not start PostgreSQL
  or provide central persistence, authentication, accounts, or multi-user
  collaboration.
- The API snapshot DTO is a transport contract, not a running API.
- No TLS, automated backups, monitoring, or production hardening is included.
- CI checks script syntax and package contents and builds/smoke-tests the Linux
  container output. Docker Desktop has not been exercised on a Windows host in
  this task; perform that acceptance check on the target machine before relying
  on it.

For the existing on-prem baseline and limitations, see
[onprem-deployment.md](onprem-deployment.md).
