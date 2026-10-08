# JingCang Deployment & Operations Guide

> Maps to CORE-008 in the development plan. Covers deployment on Windows / Linux / macOS, production environment variables and secrets, backup / migration / upgrade, offline deployment, plus security and CI gates.
> Baseline: `JingCang v1.3.0` (local `D:\codex\jingcang`). Multi-device cloud testing (Android cloud phone / mobile browser / iOS real device) is covered in `docs/JingCang-多端云测试平台-开发任务计划.md`.

---

## 1. Deployment Topology

| Shape | Compose file | Use case |
|---|---|---|
| Dev / single-host eval | `deploy/compose.yaml` | Windows (Docker Desktop + WSL2), Linux, macOS quick start |
| Mobile device-cloud dev | `deploy/compose.mobile-dev.yaml` | Attach a Device Agent, verify node enroll / heartbeat / device catalog |
| PoC | `deploy/compose.poc.yaml` | Real-device / emulator integration |
| Production | `deploy/compose.production.yaml` | Long-running Linux server: Nginx gateway, read-only FS, healthcheck |
| Offline | `scripts/install-offline-production.ps1` + image bundle | Air-gapped environments with pre-bundled images |

All shapes share the same images: `jingcang/control-api` (control plane), `nginx` (gateway), `selenium/standalone-*` (browser pods), and optional `jingcang/browser-bundle` (offline browser images).

---

## 2. Prerequisites

- **Docker Engine 24+**; Windows requires **Docker Desktop + WSL2** with ≥ 8 GB RAM (16–32 GB for heavy concurrency).
- Local **source development** only needs Node.js ≥ 22 and pnpm ≥ 9 (recommended `pnpm@11.1.2`). Production needs only Docker.
- Offline deployment needs the offline image bundle, `SHA256SUMS.txt`, `PLATFORM.txt`, and a populated `.env.production`.

---

## 3. Environment Variables & Secrets

At startup the control plane validates these **mandatory secrets**; placeholders or insufficient length abort startup:

| Variable | Min length | Description |
|---|---|---|
| `JINGCANG_SESSION_SECRET` | 32 | HttpOnly cookie session signing key |
| `JINGCANG_VIEWER_SECRET` | 32 | Short-lived Viewer Token (WebSocket auth) HMAC key |
| `JINGCANG_ADMIN_INITIAL_PASSWORD` | 12 | Initial admin password (change immediately after first login) |

Generate strong secrets (either):

```powershell
# Windows
.\scripts\bootstrap.ps1        # generates random secrets into .env
```

```bash
# Linux / macOS
openssl rand -hex 32   # for SESSION_SECRET / VIEWER_SECRET
openssl rand -hex 16   # prefix + custom string as admin password, length >= 12
```

Common runtime variables (all have defaults, override as needed):

| Variable | Default | Description |
|---|---|---|
| `JINGCANG_PORT` | 8088 | Public port |
| `JINGCANG_BIND_HOST` | 127.0.0.1 | Bind address; fixed `0.0.0.0` in container, Nginx converges |
| `JINGCANG_LAN_ACCESS_ENABLED` | false | Allow non-loopback bind |
| `JINGCANG_GRID_URL` | http://selenium-docker:4444 | Selenium Grid URL |
| `JINGCANG_SQLITE_JOURNAL_MODE` | WAL (DELETE in container) | Use `DELETE` on Windows mount to avoid `SQLITE_IOERR` |
| `JINGCANG_TRUST_PROXY` | false | Set `true` behind a reverse proxy |
| `JINGCANG_SESSION_MAX_CONCURRENCY` | 4 | Max concurrent pods |
| `JINGCANG_BROWSER_OFFLINE_MODE` | false | Offline browser image mode |
| `JINGCANG_MOBILE_AGENT_URL` | — | Points to host Agent in mobile-dev shape (e.g. `http://host.docker.internal:19879`) |

**Hard rule**: `.env` / `.env.production` contain real secrets and **must not be committed**; see `.env.example`, `deploy/.env.production.example`.

---

## 4. Windows Deployment (Docker Desktop + WSL2)

```powershell
# 1. Generate secure config (prints admin password once, writes .env)
.\scripts\bootstrap.ps1

# 2. Start the platform
docker compose -f deploy/compose.yaml up -d --build

# 3. Health check
docker compose -f deploy/compose.yaml ps
# Open http://localhost:8088
```

Common ops:

| Task | Command |
|---|---|
| View logs | `docker compose -f deploy/compose.yaml logs -f control-api` |
| Graceful restart | `docker compose -f deploy/compose.yaml restart` |
| Stop & clean | `docker compose -f deploy/compose.yaml down` |

---

## 5. Linux Deployment (Production)

```bash
# 1. Prepare production env (fill strong secrets, no change-me placeholders)
cp deploy/.env.production.example deploy/.env.production
# edit deploy/.env.production: set JINGCANG_SESSION_SECRET / VIEWER_SECRET / JINGCANG_ADMIN_INITIAL_PASSWORD

# 2. Start (Nginx gateway, read-only container, healthcheck)
docker compose -f deploy/compose.production.yaml up -d --build

# 3. Health check
curl -fsS http://localhost:8088/health/ready   # expect HTTP 200
```

- Production `compose` converges 8088 via Nginx gateway, uses `read_only` + `tmpfs`, `no-new-privileges`, and mounts the Docker socket to spin up browser pods dynamically — run inside a trusted LAN or behind an external TLS proxy.
- Expose only 8088; do not expose 4444 (Grid) or 5900 (VNC) to the public internet.

---

## 6. macOS Deployment (iOS node / local dev)

- Control plane and console are identical to Linux (Docker Desktop runs `compose.yaml`).
- **iOS real-device nodes do not run inside Docker**: the macOS host (Monterey+) needs Xcode / Command Line Tools and a developer-mode trusted real iPhone; the iOS Device Agent enrolls with the control plane. See `IOS-001~008` in the plan.
- Local dev can run via `pnpm` (see README "本地工程开发").

---

## 7. Mobile Device-Cloud Onboarding (Android / iOS)

1. Start the Device Agent (Windows / Linux host):

   ```bash
   JINGCANG_NODE_ID=win-agent-01 \
   CONTROL_API_URL=http://localhost:8088 \
   AGENT_TOKEN=<node token issued by admin> \
   node apps/device-agent/dist/index.js
   ```

2. An admin registers the node on the control plane and receives a one-time **64-hex credential** (SHA-256 stored; plaintext returned once).
3. The Agent heartbeats periodically (Bearer credential) and reports its device inventory; the control plane aggregates `GET /api/v1/devices`, `/api/v1/device-profiles`, `/api/v1/device-nodes` into a schedulable catalog.
4. Revoking a node invalidates the credential immediately; subsequent heartbeats return `401`.

> Real device / emulator / ADB / iOS operations depend on hardware PoC (`AND-002~006`, `IOS-001~005`); this guide covers only the control-plane onboarding surface.

---

## 8. Backup / Migration / Upgrade

- **Data location**: production = `jingcang_prod_db` volume; single-host = `data/db/jingcang.sqlite`.
- **Backup**: control plane has built-in `backupDatabase()` (physical, includes `-wal`/`-shm`); or copy the production volume (`docker volume inspect jingcang_prod_db`) after stopping the service.
- **Migration (versioned, idempotent)**: schema evolves via numbered migrations (`apps/control-api/src/db/migrations.ts`), applied automatically at startup; legacy `mobile_sessions` tables are **auto-patched + backfilled**, old session data is preserved; abnormal migrations can be rolled back (`rollbackTo`).
- **Upgrade flow**: ① backup → ② pull new image (`up -d --build`) → ③ healthcheck `/health/ready` → ④ watch logs for migration completion. Migrations are idempotent and re-runnable.

---

## 9. Offline Deployment

Artifacts (produced by the offline packaging flow, not in the source repo):

- Production image tar `images/production-images.tar`
- `SHA256SUMS.txt` (SHA-256 per artifact)
- `PLATFORM.txt` (target Docker platform, e.g. `linux/amd64`)
- Populated `.env.production`

Run:

```powershell
# validates checksum + platform + 3 strong secrets -> docker load -> start (--pull never)
.\scripts\install-offline-production.ps1 -Start
```

- The script rejects placeholder secrets (`change-me-`) and short variables.
- **The image bundle must match the host platform** (e.g. `linux/amd64`); otherwise `PLATFORM.txt` validation fails.

---

## 10. Security & Compliance

- Control plane alternative to mounting the host Docker socket: production `compose` mounts `docker.sock` to support dynamic browser pods — use only in a trusted LAN, behind Nginx/TLS.
- Viewer Token binds `user / session / device / lease` (HMAC-SHA256); node credentials store only SHA-256 digests, plaintext returned once.
- Passwords use `scrypt` salted hashing; login rate-limiting; artifact path-traversal checks.
- Audit events in `audit_events` cover login, session create, terminate, approval, permission changes.
- Expose only 8088; 4444 / 5900 must not be publicly reachable.

---

## 11. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `SQLITE_IOERR` (Windows mount) | Set `JINGCANG_SQLITE_JOURNAL_MODE=DELETE` |
| Old session table missing columns after upgrade | Migration auto-patches; for very early DBs, backup first then start and watch migration logs |
| Control plane refuses to start, insecure secret | Used `change-me-*` or weak default; generate strong secrets via `bootstrap.ps1` / `openssl rand` |
| Device catalog shows no node | Check Agent heartbeat carries a valid 64-hex Bearer credential; credential is valid only after node registration |

---

## 12. CI & Quality Gates

- **CI pipeline**: `.github/workflows/ci.yml` — `verify` (lint → build → contract tests → unit/integration tests), `security` (dependency audit `pnpm audit` + secret scan `gitleaks`), `package` (production image build-only).
- **Publish containers**: `.github/workflows/publish-containers.yml` — manual `workflow_dispatch` builds and pushes `ghcr.io` images and the browser offline bundle by version.
- Local equivalent: `pnpm -r lint && pnpm -r build && pnpm -r test`.

---

*Keep docs and code in sync; where docs conflict with code behavior, code and the plan `docs/JingCang-多端云测试平台-开发任务计划.md` prevail.*
