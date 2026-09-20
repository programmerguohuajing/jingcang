# 镜舱（JingCang）—— 完全本地化部署的多浏览器兼容性测试平台

<p align="center">
  <img src="apps/console-web/public/logo.svg" alt="镜舱 JingCang Logo" width="360" />
</p>

<p align="center">
  <strong>同一页面，多镜验证 · 开发者专属的轻量化本地浏览器云</strong>
</p>

<p align="center">
  <b>🇨🇳 简体中文</b> •
  <a href="README.md">🇺🇸 English</a>
</p>

<p align="center">
  <a href="#-快速启动推荐">快速启动</a> •
  <a href="#-核心特性">核心特性</a> •
  <a href="#-系统架构">系统架构</a> •
  <a href="#-本地工程开发">工程开发</a> •
  <a href="#-用户操作手册user-manual">用户操作手册</a> •
  <a href="#-常见问题与故障排查">常见问题</a>
</p>

---

## 📖 项目简介

**镜舱（JingCang）** 是一套面向前端开发与质量保证（QA）团队的完全本地化多浏览器兼容性测试平台。它能够在单台 Windows 电脑（支持 Docker Desktop + WSL2）上独立运行，提供类似 F2etest / BrowserStack 的核心体验：

用户只需在浏览器中打开镜舱控制台，即可一键动态创建相互隔离的 Chrome、Microsoft Edge 或 Firefox 测试舱；通过原生打包的 noVNC 客户端，直接在 Web 页面中远程操作浏览器的地址栏、视窗交互及开发者工具（F12），并可无缝直连调试宿主机上的 `localhost` 开发服务。

---

## ✨ 核心特性

- 🚀 **动态测试舱编排（Dynamic Grid）**：基于 Selenium Grid 4 Dynamic Node 机制，按需拉起并回收官方无头/桌面浏览器容器，彻底杜绝多任务间的 Cookie、缓存与数据交叉污染。
- ➕ **在线扩展浏览器版本**：管理员可在舱位矩阵中选择厂商并输入版本标签，系统自动下载官方 Selenium 镜像、启动并健康检查独立节点，然后接入可用舱位。
- 🖥️ **内置 Web 远程桌面（noVNC）**：控制台深度集成轻量化 noVNC 交互界面，支持鼠标手势、键盘输入、动态分辨率适配（自适应铺满 / 1:1 像素点对点）以及剪贴板同步。
- 🔗 **智能宿主机服务穿透**：内置网络转换中继，自动将输入的 `localhost`、`127.0.0.1`、`::1` 转化为 `host.docker.internal`，无需手动配置复杂 hosts 即可在隔离测试舱内调试本机正在开发的 Node / Vite / Webpack 项目。
- ⏱️ **会话生命周期与队列控制**：提供并发配额保护、排队等待机制、空闲超时（Idle Timeout）自动清理、单键延长使用时间（+30 分钟）以及强制回收策略。
- 🛡️ **内网级安全架构**：
  - Docker 控制能力仅用于受管理员权限和镜像白名单保护的动态编排；
  - 采用 HttpOnly 强安全 Cookie 会话控制与短期签名 Viewer Token（WebSocket 鉴权）；
  - 密码采用加盐 `scrypt` 算法哈希；内置登录频次限流防护与产物路径穿越校验。
- 📊 **测试产物与审计**：自动沉淀会话操作日志，支持会话运行状态监控、截图归档与受控清理。

---

## 🏗️ 系统架构

镜舱采用微模块单机拓扑结构，所有数据及镜像均保存在本地：

```
                              [ 本机用户浏览器 / 测试人员 ]
                                            │
                                            ▼ (HTTP / WebSocket :8088)
                                    ┌──────────────┐
                                    │ Nginx 网关   │ (入口鉴权反代、静态加速)
                                    └───────┬──────┘
                       ┌────────────────────┴────────────────────┐
                       │                                         │ (WebSocket 转发)
                       ▼ (HTTP / REST API)                       ▼
            ┌─────────────────────┐                   ┌─────────────────────┐
            │ Control API 调度服务 │                   │ Viewer WS Gateway   │
            │ (Fastify + SQLite)  │                   │ (短效 Token 校验)    │
            └──────────┬──────────┘                   └──────────┬──────────┘
                       │                                         │
                       ▼ (Driver API :4444)                      ▼ (RFB/VNC :5900)
            ┌─────────────────────┐                   ┌─────────────────────┐
            │ Selenium Grid Hub   │ ◄── Docker Sock ──┤ 动态浏览器测试舱    │
            │ (Dynamic Grid 4)    │                   │ [Chrome/Edge/Firefox]│
            └─────────────────────┘                   └─────────────────────┘
                                                                 │
                                                       (访问本机开发服务)
                                                                 ▼
                                                    http://host.docker.internal
```

### 技术栈一览

| 模块分层 | 技术选型 | 说明 |
|---|---|---|
| **前端控制台** | React 18, TypeScript, Vite, React Router 6, Lucide React | 现代化 Dark-Theme 暗色技术界面 |
| **远程桌面交互** | `@novnc/novnc` 纯前端客户端 | 极低延迟 Web VNC 画布呈现 |
| **控制面后端** | Fastify, TypeScript, Node.js 20+ | 高性能 API 网关与 WebSocket 会话代理 |
| **容器编排引擎** | Selenium Grid 4 Dynamic Grid + Docker Engine | 按需启动官方 `selenium/standalone-*` 镜像 |
| **数据持久化** | SQLite (Better-SQLite3) | 本地单文件轻量持久化（容器环境适配 DELETE 模式） |
| **统一反向代理** | Nginx Alpine | 端口收敛（8088）、静态文件托管、WebSocket 反代 |

---

## 🚀 快速启动（推荐）

### 1. 前置依赖
- **操作系统**：Windows 11（推荐专业版）或已启用 WSL2 的等效 Linux/macOS 环境。
- **容器环境**：已安装并运行 **Docker Desktop**（内存建议分配 $\ge 8\text{ GB}$，测试舱并发多时建议 $16\sim 32\text{ GB}$）。
- **开发运行时**：Node.js $\ge 20.0.0$，pnpm $\ge 9.0.0$（推荐使用 `pnpm@11.1.2`）。

### 2. 初始化与一键拉起

在项目根目录下打开 PowerShell 执行：

```powershell
# 1. 克隆代码并安装依赖
git clone https://github.com/your-account/jingcang.git
cd jingcang
pnpm install

# 2. 生成安全配置文件（自动初始化随机密码并生成 .env）
.\scripts\bootstrap.ps1

# 3. 通过 Docker Compose 启动整套平台
docker compose -f deploy/compose.yaml up -d --build

# 4. 执行健康检查
.\scripts\verify.ps1
```

执行完毕后，在浏览器访问：**`http://localhost:8088`**。

> **提示**：
> 初始管理员用户名为 **`admin`**。初始密码会在执行 `.\scripts\bootstrap.ps1` 时在终端输出一次，并保存在本机 `.env` 文件的 `JINGCANG_ADMIN_PASSWORD` 字段中。

---

## 🛠️ 本地工程开发

若需对前端界面、调度策略或后端服务进行源码定制与调试：

### 1. 仅启动底层 Dynamic Grid
在开发模式下先启动 Selenium Dynamic Grid，使容器引擎就绪：
```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml up -d selenium-docker
```

### 2. 本地运行 Control API
```powershell
pnpm build
node apps/control-api/dist/server.js
```
*(开发模式下 Control API 会自动检测并连接本地宿主机的 `127.0.0.1:4444`)*

### 3. 启动前端控制台热更新（Vite Dev）
```powershell
pnpm --filter @jingcang/console-web dev
```
前端默认运行于 `http://localhost:5173`，修改 `apps/console-web/src` 下的代码将实时热更新。

### 4. 代码质量与发布前验证
```powershell
pnpm lint      # 执行全局 ESLint 检查
pnpm test      # 执行单元测试
pnpm build     # 全包构建
docker compose -f deploy/compose.yaml config -q  # 校验编排文件正确性
```

---
---

# 📘 镜舱（JingCang）用户操作手册 (User Manual)

本手册专为测试工程师、前端开发工程师与系统管理员设计，指导如何高效使用镜舱开展多浏览器兼容性测试。

---

## 1. 平台登录与账户安全

### 1.1 首次登录
1. 打开浏览器输入镜舱地址：`http://localhost:8088`（若在局域网部署，请输入管理员分配的内网 IP/域名）。
2. 在登录卡片中输入用户名（默认 `admin`）及初始密码（见 `.env` 文件）。
3. 点击 **登录控制台**。登录成功后，凭证将通过强安全 `HttpOnly` Cookie 写入浏览器，有效防范 XSS 凭证窃取。

### 1.2 登出与会话失效
- 点击右上角导航栏的 **退出登录** 按钮即可主动销毁认证会话。
- 当登录凭证过期后，系统将自动重定向至登录页。

---

## 2. 浏览舱目录与创建测试舱 (Launch Pod)

登录后系统默认进入 **浏览器目录**（`/browsers`）：

<p align="center">
  <img src="apps/console-web/public/logo-icon.svg" alt="Browser Pod" width="64" />
</p>

### 2.1 浏览器支持矩阵
镜舱支持即开即用的官方主流桌面渲染引擎：
- 🌐 **Google Chrome**（Blink 内核）
- 🌊 **Microsoft Edge**（Chromium 内核）
- 🦊 **Mozilla Firefox**（Gecko 内核）

### 2.2 增加浏览器版本（管理员）

管理员如需补充内置矩阵之外的版本，可点击页面右上角的 **增加浏览器版本**，选择 Chrome、Edge、Firefox 或 Chromium，并输入官方 Selenium 镜像标签（例如 `130.0`）。页面会持续展示镜像下载、节点启动与接入进度；只有健康检查通过的节点才会进入舱位矩阵。该操作需要 Docker Engine 正常运行，首次下载可能耗时数分钟并占用额外磁盘空间。

### 2.3 创建新的测试舱
在浏览器目录卡片中，点击对应浏览器下方的 **启动测试舱** 按钮，系统将弹出启动参数配置弹窗：

| 配置项 | 可选值 | 说明 |
|---|---|---|
| **初始网址 (Initial URL)** | 任意有效 URL，如 `http://localhost:3000` 或 `https://www.example.com` | 测试舱就绪后自动在浏览器中打开该页面 |
| **视窗分辨率 (Resolution)** | `1920x1080` (推荐)、`1366x768`、`1280x720` | 模拟不同屏幕规格下的响应式布局表现 |
| **首选语言 (Language)** | `zh-CN`、`en-US` | 浏览器操作系统的默认语言与 Accept-Language 标头 |
| **时区 (Timezone)** | `Asia/Shanghai`、`UTC`、`America/New_York` 等 | 校验国际化时间与格式化逻辑 |

点击 **确定创建**，后端将向 Selenium Dynamic Grid 下发调度请求并创建独立的 Docker 浏览器容器。状态将经历 `QUEUED`（排队中）→ `INITIALIZING`（拉起容器与桌面）→ `RUNNING`（就绪），就绪后将自动跳转进入远程遥控工作台。

---

## 3. 网页远程遥控台操作指南 (Interactive Viewer)

远程工作台基于 Canvas 与 WebSocket 构建，提供流畅低延迟的浏览器原生操作环境。

### 3.1 界面顶栏控制区
- **测试舱信息**：显示当前正在运行的浏览器型号、版本号及当前状态胶囊（如 `RUNNING`）。
- **分辨率与比例**：显示当前舱位物理分辨率（如 `1920×1080`）。
- **画面缩放切换（Scaling Mode）**：
  - 🔍 **适应屏幕（Fit Viewport）**：等比例自适应浏览器窗口大小，完整预览整屏内容。
  - 🎯 **原始比例（1:1 Pixel）**：以像素点对点呈现，可通过滚动条查看真实字体粗细与局部渲染。
- **延长使用时间（+30 分钟）**：当当前会话接近到期时，点击右上角 **延长 30 分钟** 按钮即可无缝续期。
- **结束舱位**：测试完毕后，点击红色的 **结束会话**，平台将立即关闭连接并彻底销毁后端容器。

### 3.2 键盘与鼠标交互
- **鼠标事件**：支持左键点击、右键上下文菜单、双击、滚轮缩放以及长按拖拽文本/组件。
- **快捷键直通**：
  - `F12` 或右键「检查」：呼出浏览器原生开发者工具（DevTools），可调试 Elements、Console、Network 及 Application；
  - `Ctrl + C` / `Ctrl + V`：剪贴板数据直通传输；
  - `Ctrl + R` / `F5`：刷新当前测试页面；
  - `Ctrl + T` / `Ctrl + W`：新建标签页 / 关闭标签页。

### 3.3 访问宿主机服务（本机开发调试秘籍）
在日常开发中，前端项目通常运行在宿主机的 `http://localhost:3000` 或 `http://localhost:8080`。在镜舱中调试极其便捷：

> **无需手动更换 IP！**  
> 在镜舱的浏览器地址栏直接输入 `http://localhost:3000`，控制台底层已自动将流量解析路由至宿主机的真实端口（`host.docker.internal:3000`）。无论是 Cookie 传递还是接口代理，均保持与本地开发一致的体验。

---

## 4. 会话管理与生命周期 (Sessions Management)

点击导航栏中的 **会话管理**（`/sessions`），可查看所有历史与活动中的测试记录：

- 📋 **历史检索**：查看所有测试舱的启动者、浏览器版本、启止时间、持续耗时与结束原因（如 `USER_CLOSED` 正常结束、`TTL_EXPIRED` 超时回收）。
- 👁️ **随时重连**：只要舱位处于 `RUNNING` 状态，点击 **连接画面** 即可再次进入遥控台。
- 📦 **测试产物下载**：若配置了自动截图或录屏，会话结束后可直接点击下载对应的图片或视频文件。

---

## 5. 系统运维与管理监控 (Admin Dashboard)

管理员用户登录后，导航栏将显示 **管理后台**（`/admin`）：

### 5.1 监控大盘指标
- **活动舱位总数**：当前正在运行的容器总数。
- **并发利用率**：对照系统允许的最大并发上限（默认 4 个）展示负载率。
- **排队队列长度**：因资源达到上限而等待分配的会话请求数。
- **内存与 CPU 负载**：底层 Docker 主机资源消耗估算。

### 5.2 常用运维命令清单 (PowerShell)

| 运维场景 | 对应操作命令 |
|---|---|
| **备份系统配置与数据库** | `.\scripts\backup.ps1` |
| **从历史备份中恢复** | `.\scripts\restore.ps1 -BackupFile <路径>` |
| **拉取并更新浏览器目录镜像**| `.\scripts\update-browser-catalog.ps1` |
| **查看实时运行日志** | `docker compose -f deploy/compose.yaml logs -f control-api` |
| **平滑重启所有服务** | `docker compose -f deploy/compose.yaml restart` |
| **彻底停止并清理容器** | `docker compose -f deploy/compose.yaml down` |

---

## 6. 常见问题与故障排查 (FAQ)

#### Q1: 画面提示「测试舱画面连接失败」或一直黑屏？
- **原因 1**：浏览器镜像首次拉取耗时较长，动态容器尚在启动阶段。
  - **解决**：点击界面中央的 **重新尝试连线** 按钮；或提前使用 `docker pull selenium/standalone-chrome:latest` 预缓存镜像。
- **原因 2**：WebSocket 网关连线被代理拦截。
  - **解决**：确保客户端能够正常访问网关端口（`8088`），若有外部反代请确保启用了 `Upgrade: websocket` 转发。

#### Q2: 为什么无法访问本机运行的 `http://localhost:8000`？
- 确认 Windows 宿主机防火墙未阻止 Docker 内部虚拟网卡（`vEthernet`）对本地端口的监听；
- 确认本地开发服务没有仅绑定在 `127.0.0.1`，建议开发服务器监听 `0.0.0.0`。

#### Q3: Windows Docker 环境报 `SQLITE_IOERR` 错误？
- 镜舱在容器部署模式下默认已开启 `PRAGMA journal_mode = DELETE`，彻底绕过了 Windows 宿主机挂载卷对 WAL/SHM 锁机制的兼容性缺陷。如果手工部署出现该错误，请检查 `.env` 中 `JINGCANG_DB_JOURNAL_MODE` 是否正确设置为 `DELETE`。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源许可证。
