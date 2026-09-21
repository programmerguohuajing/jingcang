# JingCang (镜舱) — Fully Localized Multi-Browser Compatibility Testing Platform

<p align="center">
  <img src="apps/console-web/public/logo.svg" alt="JingCang Logo" width="360" />
</p>

<p align="center">
  <strong>Same Page, Multi-Perspective Verification · The Lightweight Local Browser Cloud for Developers</strong>
</p>

<p align="center">
  <b>🇺🇸 English</b> •
  <a href="README_CN.md">🇨🇳 简体中文文档</a>
</p>

<p align="center">
  <a href="#-quickstart-recommended">Quickstart</a> •
  <a href="#-core-features">Core Features</a> •
  <a href="#-system-architecture">Architecture</a> •
  <a href="#-local-development">Development</a> •
  <a href="#-user-manual--operations-guide">User Manual</a> •
  <a href="#-troubleshooting--faq">FAQ</a>
</p>

---

## 📖 Project Overview

**JingCang (镜舱)** is a fully localized multi-browser compatibility testing platform tailored for front-end developers, QA engineers, and automated test runners. It is capable of running as a self-contained environment on a single Windows 11 workstation (with Docker Desktop + WSL2), offering the core convenience of cloud-based browser testing solutions like F2etest or BrowserStack without external cloud dependencies:

Users simply navigate to the JingCang Web Console, select a browser engine and version, launch an isolated browser pod, and directly interact with the browser window, address bar, and native Developer Tools (F12) via embedded noVNC canvas. Furthermore, it allows seamless out-of-the-box debugging of `localhost` development servers hosted on the developer's physical machine.

---

## ✨ Core Features

- 🚀 **Dynamic Browser Pods (Dynamic Grid)**: Powered by the Selenium Grid 4 Dynamic Node mechanism, browser containers (Chrome, Edge, Firefox) are spun up on-demand and destroyed upon session termination, preventing cookie leaks, cache pollution, or cross-test data contamination.
- 🖥️ **Embedded Web Remote Desktop (noVNC)**: Seamlessly integrates the `@novnc/novnc` canvas client within the console. Supports precise mouse gestures, keyboard inputs, custom scale modes (Fit Viewport vs. 1:1 Pixel Mapping), and bidirectional clipboard synchronization.
- 🔗 **Intelligent Host Network Passthrough**: Built-in address transformation relays `localhost`, `127.0.0.1`, and `::1` queries straight to `host.docker.internal`, allowing pods to test local Vite, Webpack, or Node dev servers with zero configuration.
- 👥 **Role-Based Access Control (RBAC) & Approval Center**:
  - Three user roles: `Admin` (Superuser), `Developer` (Engineering), and `Tester` (QA);
  - Fine-grained browser access policies (`ALL` permitted vs. `CUSTOM` whitelist);
  - Users can initiate in-app access requests with justification notes; administrators review and approve/reject them centrally in the Approval Center.
- 🌓 **Dual-Theme Design System (Light / Dark)**: Defaults to a clean, high-clarity Light theme, with a smooth one-click toggle in the navbar to switch to a sleek Dark mode. Theme preference is automatically remembered.
- 📥 **On-Demand Browser Provisioning**: Administrators can search, pull, and install new official Selenium browser images directly from the Web UI, expanding the testing matrix on the fly.
- ⏱️ **Session Lifecycle & Queue Management**: Built-in concurrency rate limiting, fair queueing, idle timeout reaping, single-click session extension (+30 min), and aggressive stale container cleanup.
- 🛡️ **Zero-Trust Security Architecture**:
  - Control API does NOT mount Docker Socket, significantly reducing potential privilege escalation vectors;
  - Authenticated via HttpOnly secure session cookies and ephemeral HMAC/JWT signed Viewer Tokens for WebSocket sessions;
  - Password hashing utilizing salted `scrypt`; login rate limiting and path traversal protection for all test artifact downloads.
- 📊 **Audit Logs & Artifact Collection**: Automatically records structured audit logs, session timelines, screenshots, and optional video recordings with disk quota enforcement.

---

## 🏗️ System Architecture

JingCang employs a modular, single-node topology with zero external cloud dependencies:

```
                            [ User Web Browser / QA Engineer ]
                                            │
                                            ▼ (HTTP / WebSocket :8088)
                                    ┌──────────────┐
                                    │ Nginx Gateway│ (Unified Reverse Proxy, Static Host)
                                    └───────┬──────┘
                       ┌────────────────────┴────────────────────┐
                       │                                         │ (WebSocket Proxy)
                       ▼ (HTTP / REST API)                       ▼
            ┌─────────────────────┐                   ┌─────────────────────┐
            │ Control API Service │                   │ Viewer WS Gateway   │
            │ (Fastify + SQLite)  │                   │ (Ephemeral Token)   │
            └──────────┬──────────┘                   └──────────┬──────────┘
                       │                                         │
                       ▼ (Driver API :4444)                      ▼ (RFB/VNC :5900)
            ┌─────────────────────┐                   ┌─────────────────────┐
            │ Selenium Grid Hub   │ ◄── Docker Sock ──┤ Dynamic Browser Pod │
            │ (Dynamic Grid 4)    │                   │ [Chrome/Edge/Firefox]│
            └──────────┬──────────┘                   └─────────────────────┘
                       │                                         │
                       │ (RBAC & Approvals)            (Access Host Dev Services)
                       ▼                                         ▼
            ┌─────────────────────┐                 http://host.docker.internal
            │ Local SQLite Store  │
            │ (Users/Permissions) │
            └─────────────────────┘
```

### Technology Stack

| Layer / Component | Technology | Role & Details |
|---|---|---|
| **Console Frontend** | React 18, TypeScript, Vite, React Router 6, Lucide React | Modern dual-theme (Light/Dark) responsive interface |
| **Remote Display** | `@novnc/novnc` Pure JS Canvas Client | Low-latency in-browser interactive RFB canvas |
| **Control Backend** | Fastify, TypeScript, Node.js 20+ | High-throughput API gateway, approval engine & WS proxy |
| **Container Engine** | Selenium Grid 4 Dynamic Grid + Docker Engine | Launches official `selenium/standalone-*` images |
| **Access Control** | RBAC Policy Engine + Approval Center | Vendor & version-level browser whitelist management |
| **Data Storage** | SQLite (Better-SQLite3) | Embedded ACID database (`DELETE` journal in containers) |
| **Reverse Proxy** | Nginx Alpine | Port convergence (:8088), static asset caching, WS proxy |

---

## 🚀 Quickstart (Recommended)

### 1. Prerequisites
- **Operating System**: Windows 11 (Pro recommended) or equivalent Linux/macOS host with WSL2 enabled.
- **Container Runtime**: **Docker Desktop** installed and running (Minimum 8 GB RAM allocated; 16–32 GB recommended for multi-pod concurrency).
- **Node Environment**: Node.js $\ge 20.0.0$, pnpm $\ge 9.0.0$ (recommend `pnpm@11.1.2`).

### 2. Initialization and One-Click Bootstrap

Open a PowerShell terminal in the repository root:

```powershell
# 1. Clone repository and install dependencies
git clone https://github.com/your-account/jingcang.git
cd jingcang
pnpm install

# 2. Generate secure secrets and configuration (bootstraps admin credentials & .env)
.\scripts\bootstrap.ps1

# 3. Launch full stack via Docker Compose
docker compose -f deploy/compose.yaml up -d --build

# 4. Verify system health
.\scripts\verify.ps1
```

Once deployment finishes, open your browser and navigate to: **`http://localhost:8088`**.

> **Note**:  
> The default administrator username is **`admin`**. The randomly generated password is displayed once during `.\scripts\bootstrap.ps1` and saved locally in your `.env` file under `JINGCANG_ADMIN_PASSWORD`.

---

## 🛠️ Local Development

For engineers wishing to modify the frontend UI, scheduler logic, or API endpoints:

### 1. Run Dynamic Grid Only
Start the Selenium Dynamic Grid node to accept container requests:
```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml up -d selenium-docker
```

### 2. Start Local Control API
```powershell
pnpm build
node apps/control-api/dist/server.js
```
*(In dev mode, Control API automatically forwards grid traffic to `127.0.0.1:4444`)*

### 3. Start Frontend Hot Reload (Vite Dev Server)
```powershell
pnpm --filter @jingcang/console-web dev
```
The console will start at `http://localhost:5173`. Any changes in `apps/console-web/src` will hot-reload instantly.

### 4. Code Quality & Pre-release Checks
```powershell
pnpm lint      # Lint across all monorepo packages
pnpm test      # Run automated unit tests
pnpm build     # Verify end-to-end production compilation
docker compose -f deploy/compose.yaml config -q  # Validate compose schema
```

---
---

# 📘 JingCang User Manual & Operations Guide

This manual serves as a hands-on guide for QA engineers, frontend developers, and administrators on conducting effective cross-browser compatibility evaluations.

---

## 1. Authentication, User Roles & Themes

### 1.1 Logging In
1. Navigate to the JingCang portal: `http://localhost:8088` (or the IP/domain designated by your infrastructure administrator).
2. Enter your credentials (`admin` by default, alongside the password generated during bootstrap).
3. Click **登录控制台 (Sign In)**. Upon successful authentication, a cryptographically signed `HttpOnly` cookie is established, insulating sessions against script-based XSS extraction.

### 1.2 User Roles & Permissions Matrix
JingCang implements a three-tier Role-Based Access Control (RBAC) model:
- **Administrator (`admin`)**: Full platform control. Manages user accounts, approves/rejects browser access requests, pulls new browser images, and performs maintenance.
- **Developer (`developer`)**: Accesses authorized browser pods, performs interactive tests, and uses DevTools for local debugging.
- **Tester (`tester`)**: Executes cross-browser validation suites and exports artifacts. Can request permission for restricted browsers with one click.

### 1.3 Dual-Theme System (Light / Dark)
- Click the **Theme Toggle** (☀️ / 🌙) located on the right side of the top navbar.
- Switch seamlessly between the default high-clarity **Light** mode and the sleek **Dark** theme. Your preference is persisted across browser refreshes.

---

## 2. Browser Catalog, Access Requests & Provisioning

Upon signing in, you will be greeted by the **Browser Catalog** (`/browsers`):

<p align="center">
  <img src="apps/console-web/public/logo-icon.svg" alt="Browser Pod" width="64" />
</p>

### 2.1 Supported Browser Families
Browsers are organized into clear vendor categories:
- 🌐 **Google Chrome** (Blink engine, official stable & regression versions)
- 🌊 **Microsoft Edge** (Chromium engine, enterprise standard)
- 🦊 **Mozilla Firefox** (Gecko / Quantum engine, independent rendering)
- ⚛️ **Chromium** (Open-source baseline Web standard)

### 2.2 Launching an Authorized Browser Pod
For browsers where you have launch permissions, click **启动测试舱 (Launch Pod)** to open the launch configuration modal:

| Option | Values | Purpose |
|---|---|---|
| **初始网址 (Initial URL)** | Any valid URL, e.g. `http://localhost:3000` or `https://google.com` | Automatically opened in the browser immediately upon pod initialization |
| **视窗分辨率 (Resolution)** | `1920x1080` (Recommended), `1366x768`, `1280x720` | Configures the virtual X11 screen size to test responsive layouts |
| **首选语言 (Language)** | `zh-CN`, `en-US` | Sets OS locale and browser `Accept-Language` headers |
| **时区 (Timezone)** | `Asia/Shanghai`, `UTC`, `America/New_York`, etc. | Validates timezone localization & date handling |

Click **确定创建 (Confirm & Launch)**. The scheduler allocates resources, transitioning through `QUEUED` → `INITIALIZING` → `RUNNING`. You will be automatically redirected into the interactive remote viewer.

### 2.3 Access Denied & In-App Approval Requests
- If your account does not have permission to launch a specific browser version, the card displays a **Lock badge** and the button changes to **申请权限 (Request Access)**.
- Click **申请权限 (Request Access)** to open the submission modal, enter your business justification (e.g., *Verifying flexbox layout bugs reported in Firefox 115 ESR*), and submit.
- The request immediately enters the administrator's **Approval Center** for review.

### 2.4 On-Demand Image Provisioning (Admin Feature)
- Administrators can click **装配新版本 (Install New Version)** in the top right corner of the catalog.
- Select the vendor and image tag (e.g. `selenium/standalone-firefox:latest`), and the system will pull the image and register it in the catalog dynamically without requiring a server restart.

---

## 3. Interactive Web Remote Viewer Guide

The viewer leverages WebSocket streaming directly to an HTML5 canvas to deliver a responsive, near-zero-latency desktop experience.

### 3.1 Control Bar Features
- **Pod Details**: Shows current browser type, version, and status badge (`RUNNING`).
- **Resolution**: Displays the active viewport geometry (e.g. `1920×1080`).
- **Scaling Mode (画面缩放)**:
  - 🔍 **适应屏幕 (Fit Viewport)**: Proportionally fits the remote desktop inside your current window without requiring page scrolling.
  - 🎯 **原始比例 (1:1 Pixel Mapping)**: Displays pixel-perfect rendering with natural font weight and anti-aliasing; useful for pixel-matching QA.
- **Extend Duration (延长 30 分钟)**: Click this button to add 30 minutes to your active session TTL when running long-form manual test suites.
- **Terminate Session (结束会话)**: Safely closes the VNC stream and immediately reaps the backend container via a custom confirmation modal.

### 3.2 Mouse, Keyboard & DevTools
- **Full Mouse Support**: Left click, right click (context menu), double click, scrolling, and dragging.
- **Shortcuts & DevTools**:
  - `F12` or Right-Click → Inspect: Opens the native browser Developer Tools to inspect DOM elements, check console errors, monitor network traffic, and read local storage;
  - `Ctrl + C` / `Ctrl + V`: Full bidirectional clipboard synchronization;
  - `Ctrl + R` / `F5`: Reload active web page;
  - `Ctrl + T` / `Ctrl + W`: Open / close browser tabs.

### 3.3 Debugging Local Dev Servers (`localhost` Routing)
Frontend development commonly takes place on `http://localhost:3000` or `http://localhost:8080` on your physical machine.

> **Zero Configuration Required!**  
> Simply type `http://localhost:3000` into the browser pod's address bar. The built-in proxy layer will automatically translate the request to `host.docker.internal:3000`. Cookies, WebSockets, and API requests behave identically to a direct local browser.

---

## 4. Session Lifecycle & Historical Records

Click **会话管理 (Sessions)** (`/sessions`) to monitor active and past sessions:

- 📋 **Multi-Dimensional Filtering**: Search by browser vendor or filter by status (`RUNNING`, `TERMINATED`, `FAILED`).
- 👁️ **Instant Reconnect**: Active `RUNNING` sessions can be re-entered at any time by clicking **连接画面 (Connect)**.
- 🛑 **Graceful Termination**: Terminate running sessions directly from the list with customized confirmation modals.
- 📦 **Artifact Downloads**: If video recording or screenshots are enabled, download links appear in the session details after termination.

---

## 5. Four-Pillar Admin Dashboard

Users with administrator privileges have access to the **管理后台 (Admin Dashboard)** (`/admin`):

### 5.1 System Overview (系统概览)
- **Real-Time Telemetry**: Active pod counts, concurrency load vs. maximum threshold (default: 4 pods), and pending queue depth.
- **Host Resource Estimates**: Host Docker CPU and memory footprint indicators.
- **One-Click Maintenance**: Clean up orphaned containers or purge expired test artifacts with single clicks.

### 5.2 User Management & Whitelist Permissions (用户管理)
- **User Directory**: View all registered accounts, assigned roles, and current status (Active / Disabled).
- **Create User**: Add new users with specified initial passwords and roles (`admin`, `developer`, `tester`).
- **Account State Toggle**: Quickly freeze or reinstate user login access with confirmation.
- **Browser Permission Allocation**:
  - Click **配置权限 (Configure Permissions)** on any user;
  - **Policy**: Choose `ALL` (Permit all existing and future browsers) or `CUSTOM` (Fine-grained selection);
  - Under `CUSTOM`, toggle specific browser engine versions organized by vendor (Chrome, Edge, Firefox).

### 5.3 Approval Center (审批中心)
- **Pending Badges**: Live counters display pending approval requests requiring admin attention.
- **Request Inspection**: Review applicant identity, requested browser, timestamp, and detailed justification.
- **Status Filter**: Easily filter between `ALL`, `PENDING`, `APPROVED`, and `REJECTED`.
- **Action Workflow**: Click **审批 (Review)**, select **Approve** or **Reject**, attach reviewer notes, and submit. Granted permissions take effect immediately without requiring user re-login.

### 5.4 Audit Trail (安全审计日志)
- Comprehensive traceability recording all critical events: authentications, session launches, terminations, access requests, admin approvals/rejections, and configuration changes.
- Contains timestamps, user identity, action names, target resources, and contextual payloads.

### 5.5 PowerShell Management Command Cheatsheet

| Task | Command |
|---|---|
| **Backup DB & Configuration** | `.\scripts\backup.ps1` |
| **Restore from Backup Archive**| `.\scripts\restore.ps1 -BackupFile <path_to_zip>` |
| **Pull & Update Browser Images**| `.\scripts\update-browser-catalog.ps1` |
| **View Control API Logs** | `docker compose -f deploy/compose.yaml logs -f control-api` |
| **Graceful Restart All Services**| `docker compose -f deploy/compose.yaml restart` |
| **Tear Down All Containers** | `docker compose -f deploy/compose.yaml down` |

---

## 6. Troubleshooting & FAQ

#### Q1: "测试舱画面连接失败" (Connection Failed) or perpetual blank screen?
- **Cause 1**: The requested browser image is being pulled for the first time, delaying container readiness.
  - **Remedy**: Click **重新尝试连线 (Retry Connection)** in the viewer center, or pre-cache images beforehand via `docker pull selenium/standalone-chrome:latest`.
- **Cause 2**: WebSocket connection blocked by reverse proxy.
  - **Remedy**: Verify port `8088` is unobstructed and that any intermediate proxy explicitly supports `Upgrade: websocket` headers.

#### Q2: Why is a browser card locked with a "Request Access" button?
- This indicates that your account has a `CUSTOM` access policy and has not been granted access to this browser. Click **申请权限 (Request Access)**, submit your business reason, and await review by an administrator.

#### Q3: Cannot access `http://localhost:8000` from inside the pod?
- Verify that your Windows Firewall does not restrict Docker NAT traffic (`vEthernet`).
- Ensure the local dev server is listening on `0.0.0.0` rather than strictly `127.0.0.1`.

#### Q4: Encountering `SQLITE_IOERR` on Windows Docker Desktop?
- JingCang enforces `PRAGMA journal_mode = DELETE` inside containerized deployments to circumvent known file-lock limitations with WSL2 bind mounts on SQLite WAL/SHM files. Verify `JINGCANG_DB_JOURNAL_MODE=DELETE` in your `.env` file if manual overrides were applied.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
