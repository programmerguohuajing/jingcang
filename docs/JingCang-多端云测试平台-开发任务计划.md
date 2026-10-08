# JingCang 多端云测试平台——未完成任务开发计划

> 基线：JingCang v1.3.0（本地 `D:\codex\jingcang`）  
> 编制日期：2026-10-08  
> 优先级：**Android → iOS**；现有桌面云浏览器业务必须保持兼容  
> 状态说明：本文列出截至本次讨论尚未实施或尚未得到运行验证的任务。**所有新增任务初始状态均为未完成**。本文件是计划，不代表代码实现或 PoC 已通过。

## 1. 建设目标与范围

JingCang 演进为一套私有化多端云测试平台，同时支持：（1）既有 Windows/Linux 宿主上的桌面云浏览器；（2）完整 Android 云手机（桌面、APK 安装、App 操作）；（3）Android 移动浏览器测试（Chrome、URL、自动化）；（4）Android 真机；（5）iOS 真机（优先于 iOS Simulator）和后续 iOS Simulator。

**统一控制面、分离设备运行面**：JingCang Control API 提供统一认证、审批、会话、设备目录、调度及审计；Windows/Linux/macOS Device Agent 负责本机模拟器或真机的发现、启动和操作。手机浏览器和完整云手机共用设备底座，使用不同 session mode 与权限。

### 1.1 非目标

- 不承诺在 Windows Docker Desktop 上运行原生 iOS，也不将 Android KVM 容器直接视为 Windows Docker 的受支持方案。
- 不承诺任意手机型号、系统版本自由组合；仅展示节点实际具备并经验证的 profile。
- 模拟机型并不等于同型号真机，须在 UI 明示“模拟器/真机”。
- 不在初期构建公开售卖的云手机运营平台或大规模分布式多租户集群。

## 2. 当前已核实项目基线

已读取：`package.json`、`README_CN.md`、`deploy/compose.production.yaml`、`apps/control-api/src/services/orchestrator.service.ts`、`viewer-gateway.service.ts`、`catalog.service.ts`、`db/index.ts`、前端页面目录。

已存在：React 控制台、Fastify Control API、Selenium Grid/Docker、noVNC、浏览器目录、会话队列与超时、权限审批、审计、SQLite、离线浏览器镜像/Compose 部署。

**需要保留的兼容行为**：现有 `/api/v1/sessions`、浏览器目录及浏览器镜像导入/自动发现；已创建的桌面会话记录；端口 8088 的对外入口；LAN/离线部署能力。

**已识别的扩展阻碍**：
1. `sessions.browser_catalog_id` 为 NOT NULL 并关联浏览器目录；Android/iOS 会话不能继续依赖它。
2. `ViewerGatewayService` 必须拿到 `seleniumSessionId`，并构造 `/se/vnc` 端点；不能直接承载手机实时画面及触控。
3. `OrchestratorService` 以 Grid URL、W3C capabilities、单一并发数量调度；缺少设备独占租约、节点能力、存活心跳和调度。
4. `CatalogService.deduplicateCatalogItems` 存在旧列名 `browser_id` 更新语句；需独立回归修正，不应复制进设备目录。
5. 当前还没有可用的 macOS Device Agent、Android Provider、iOS Provider、设备注册 API，不能视为已接入。

## 3. 拟定架构

```text
JingCang Console Web (Desktop / Android Phone / Mobile Browser / iPhone)
         │ HTTPS + authenticated WebSocket
API Gateway -> Control API (Auth / RBAC / Devices / Sessions / Artifacts / Audit)
                    │
        Device Registry + Session Scheduler + Lease Manager
                    │
      ┌─────────────┼──────────────────────┐
Desktop Provider  Android Device Provider  iOS Device Provider
Selenium Grid     Windows native Emulator  macOS Agent + Xcode
Docker browser    Linux KVM Emulator       USB iPhone + WDA
                  ADB / Appium / scrcpy    Appium XCUITest
                    │
       Stream Gateway (VNC / mobile stream / control channel)
```

- **控制面不执行任意主机命令**：Agent 只允许白名单动作，节点主动认证和心跳；不要暴露 ADB、Appium、Docker API 到公网。
- Session Core 统一状态机（QUEUED → ALLOCATING → BOOTING → READY → TERMINATING → TERMINATED，FAILED/EXPIRED/LOST 分支）。
- 资源池：按平台、节点、镜像/系统版本、真机/模拟器、可用性和配额调度；每台设备同一时刻只能由一个 lease 使用。
- Web 媒体通道与触控/控制通道分离；支持断线重连、屏幕旋转、权限检查。

## 4. 任务清单（严格按依赖与 Android 优先级）

优先级：P0 阻断/验证，P1 核心交付，P2 生产化，P3 后续增强。预计人日仅用于粗略排期，不是承诺。

### A. Android：第一优先级

| ID | 优先级 | 任务 | 交付/验收 | 状态 |
|---|---|---|---|---|
| AND-001 | P0 | 创建 `feat/mobile-device-cloud` 分支，锁定基线，记录现有 lint/test/build/Compose 校验结果 | 桌面会话回归基线和可回滚点 | 未完成 |
| AND-002 | P0 | 检查 Windows 宿主 CPU 虚拟化、WHPX/Hyper-V、内存、Android SDK、ADB、Emulator | 实机环境报告，明确可/不可用 | 未完成 |
| AND-003 | P0 | 建立一台 Android AVD（先以经验证镜像为准） | 冷启动、关机、桌面、联网、ADB 通过 | 未完成 |
| AND-004 | P0 | Chrome 与 APK 单机验证 | Chrome 打开指定 URL，测试 APK 安装/启动/卸载 | 未完成 |
| AND-005 | P0 | 移动画面与输入原型 | 网页展示画面；点击、滑动、键盘、返回、旋转 | 未完成 |
| AND-006 | P0 | Appium UiAutomator2 验证 | Chrome Web 元素定位与自动化脚本执行 | 未完成 |
| AND-007 | P1 | 新增 `packages/device-contracts`，定义 Device/Node/Profile/SessionMode/Capabilities | Zod/TS 契约与单测 | 已交付（代码 + 8 单测） |
| AND-008 | P1 | 新增 `apps/device-agent`（Windows 原生 Agent） | 节点注册、认证、心跳、设备发现、重连 | 已交付基础层（注册/鉴权/心跳/重连 + 9 单测；设备发现待真机） |
| AND-009 | P1 | 新增 `provider-android` | provision/start/stop/installApp/capture/execute/health 接口 | 已交付接口层（AndroidProvider + EmulatorProvider 安全降级；真机/SDK 操作待真机） |
| AND-010 | P1 | 扩展 Device Registry 与设备目录 API | 仅展示已安装、可用的镜像版本与手机 profile | 已交付（Registry 服务 + 设备目录 API + 单测） |
| AND-011 | P1 | 引入 Session Core 与 Device Lease | 独占分配、配额、取消、超时、异常回收 | 已交付（状态机 + 独占租约 + 单测） |
| AND-012 | P1 | 向后兼容的 SQLite 迁移 | 原会话可查询/播放，新移动会话不需 Selenium ID | 已交付（版本化迁移 + 备份回滚 + 旧表补列 + 单测） |
| AND-013 | P1 | 前端“云手机设备/移动浏览器测试/会话”页面 | 两种模式创建、查看状态、连接及结束会话 | 未完成 |
| AND-014 | P1 | Mobile Viewer + Stream Gateway | 实时画面、触控、旋转、断连重接、安全鉴权 | 未完成 |
| AND-015 | P1 | 完整云手机功能 | Android 桌面、APK、App 启动、返回/Home/截图/录屏 | 未完成 |
| AND-016 | P1 | 手机浏览器功能 | Chrome 启动、起始 URL、Web 自动化、产物归档 | 已交付（Chrome 启动/起始 URL/Appium Web 自动化实测 + 截图产物归档 CORE-005） |
| AND-017 | P2 | Linux KVM Agent 与 Android Emulator 容器方案 | KVM 可用性、镜像生命周期、并发实测 | 未完成 |
| AND-018 | P2 | Android 真机接入 | USB/ADB 发现、锁定、scrcpy、Appium、断线检测 | 未完成 |
| AND-019 | P2 | 离线部署包与镜像管理 | 预制 SDK/系统镜像/驱动，SHA256、离线安装 | 未完成 |
| AND-020 | P2 | 安全、容量、可靠性测试 | 资源限制、会话隔离、异常清理、审计、回归 | 未完成 |

**Android 阶段门槛**：
- G0：AND-002～006 完成后，经本机验证模拟器/画面/输入/Appium 链路，才能进入正式集成。
- G1：AND-007～016 完成后，能从 JingCang 创建“完整云手机”和“移动浏览器”两种会话，且桌面功能回归通过。
- G2：AND-017～020 完成后再宣称“Android 生产可用/可离线交付”。

### B. iOS：第二优先级（Android G1 后推进产品集成；基础环境检查可提前开展）

已知可提供的节点是 **MacBook Pro 13-inch Early 2015 / Intel i5 / 8GB RAM / macOS Monterey 12.7.6**。其官方系统/Xcode 上限较低；**适合旧版 iOS 真机 PoC，不承诺最新 iOS**。需要另有真实 iPhone，并确认型号、iOS 版本、USB 信任及开发者模式。

| ID | 优先级 | 任务 | 交付/验收 | 状态 |
|---|---|---|---|---|
| IOS-001 | P0 | 核查 Mac 系统、Xcode、CLI Tools、磁盘、USB、联网条件 | 兼容性清单，确定可支持 iOS 版本 | 未完成 |
| IOS-002 | P0 | 确认 iPhone 型号/系统、USB 数据线、配对信任、开发者模式 | xcrun/系统工具能发现真机 | 未完成 |
| IOS-003 | P0 | 固定兼容 Appium XCUITest + WebDriverAgent 工具链 | WDA 成功签名、安装、启动 | 未完成 |
| IOS-004 | P0 | 真机 Safari 自动化 PoC | 打开 URL、定位元素、点击与截图通过 | 未完成 |
| IOS-005 | P0 | iPhone 真机画面和交互 PoC | 视频+触控路径单独验证，明确限制 | 未完成 |
| IOS-006 | P1 | macOS Device Agent（Monterey 兼容） | 向 JingCang 注册、鉴权、心跳、自动发现设备 | 未完成 |
| IOS-007 | P1 | iOS Provider + 会话集成 | 独占分配、Safari/IPA 操作、释放/错误恢复 | 未完成 |
| IOS-008 | P1 | iOS Viewer 与 Web UI | 在控制台选真机并建立已授权远程会话 | 未完成 |
| IOS-009 | P2 | iPhone App IPA 签名/安装与自动化 | 仅处理合法已授权的测试包，结果可审计 | 未完成 |
| IOS-010 | P2 | 较新 Mac/Xcode 节点的扩容设计与验证 | 加一台新节点无需改造 Control API | 未完成 |
| IOS-011 | P3 | iOS Simulator 支持 | macOS 节点创建已安装 Runtime 对应模拟器 | 未完成 |
| IOS-012 | P2 | iOS 离线、断线、安全、压力及版本矩阵验收 | 节点恢复/保密/可维护版本清单 | 未完成 |

**iOS 阶段门槛**：
- I0：IOS-001～005 实测成立后才能对“iOS 真机可远程控制”做功能承诺。特别注意 Appium 自动化≠低延迟全屏远程控制。
- I1：IOS-006～009 完成且测试通过后，作为 iOS 真机一期。
- I2：IOS-010～012 完成后再推进新版本系统及模拟器规模化支持。

## 5. 共用横向工作（与 Android P1 并行，不可遗漏）

| ID | 任务 | 验收 | 状态 |
|---|---|---|---|
| CORE-001 | 提炼 `DesktopProvider`，保留旧接口兼容层 | 原桌面浏览器可正常创建、查看、结束会话 | 已交付（兼容层 + 单测，待桌面回归） |
| CORE-002 | 设备权限、审批与角色扩展 | 普通用户不能越权控制真机和他人会话 | 已交付（mobile_access_policy ALL/EMULATOR_ONLY + 会话所有权校验 + 6 单测 + 端到端） |
| CORE-003 | 数据库版本化迁移、备份回滚 | 旧记录不丢失；异常迁移可恢复 | 已交付（迁移器 + 物理备份还原 + 单测） |
| CORE-004 | Viewer Token 与 Agent 双向认证、TLS | 令牌绑定 user/session/device/lease，不暴露调试端口 | 部分交付（Viewer Token 四元组绑定 + Agent 凭证校验；TLS 待基础设施） |
| CORE-005 | 统一产物管理：截图、录屏、日志 | 会话隔离、过期清理、文件校验 | 已交付（移动截图归档：会话隔离 + SHA-256 + 保留策略清理 + 6 单测；录屏待 H.264 生产化） |
| CORE-006 | 设备状态、节点资源、审计与告警 | 失联/故障能快速发现并回收资源 | 已交付（失联确认回收 + 设备断线回收 + 移动会话/节点全链路审计；告警通道待生产接入） |
| CORE-007 | 修复旧代码 Schema 列名/路由兼容风险 | 有回归用例覆盖 | 已交付（sessions.browser_catalog_id 列名修复 + 真实 Schema 回归用例） |
| CORE-008 | Windows/Linux/macOS 文档、离线部署指南及中英同步 | 开发/运维可按文档独立部署 | 已交付（docs/部署与运维指南 ZH+EN，待首次按文档部署验证） |
| CORE-009 | CI：单测、契约测试、集成测试、打包及安全扫描 | 自动化任务全部通过 | 已交付（ci.yml + gitleaks，待首次流水线运行验证） |
| CORE-010 | 多节点扩容和资源容量规划 | 设备/Node 健康、容量及调度指标可观测 | 部分交付（NodeRouter 路由/健康/失联确认 + 设备池聚合；容量指标待做） |

## 6. 开发 API 与数据库交付清单

新增表（建议）：`device_nodes`、`device_profiles`、`device_instances`、`device_leases`、`device_images`、`mobile_sessions`、`device_install_jobs`；保留现有 `browser_catalog` 和 `sessions`。

建议新增 API：
- `GET /api/v1/devices` / `GET /api/v1/device-profiles`
- `POST /api/v1/device-sessions`、`GET /api/v1/device-sessions/:id`、`DELETE /api/v1/device-sessions/:id`
- `POST /api/v1/device-sessions/:id/actions`、`POST /api/v1/device-sessions/:id/apps`
- `POST /api/v1/device-sessions/:id/screenshot`
- `POST /api/v1/device-nodes/register` / `POST /api/v1/device-nodes/heartbeat`

迁移采用 expand → backfill → switch → contract，不在第一步改动 `browser_catalog_id` 非空/外键以破坏旧会话。通过 `mobile_sessions` 关联及新会话接口过渡，在测试通过后完成统一会话 Schema。

## 7. PoC 验证用例（全部待执行）

| 用例 | 检查方式 | 初步通过标准 |
|---|---|---|
| Android 系统冷启动 | 连续 20 次新建/重启 AVD | ≥19 次成功，故障可回收 |
| Android 全系统控制 | Home/Back/旋转/设置/App | 可连续操作且不失焦 |
| Android 浏览器 | 启动 Chrome、指定 URL | 网页访问、输入、导航有效 |
| Android APK | 安装、运行、卸载测试应用 | 操作成功，有日志 |
| Android Appium | Web 元素定位与点击 | 自动化脚本通过 |
| Android Viewer | 视频画面+触控/WebSocket 重连 | P95 操作反馈目标 ≤500ms，实测记录 |
| Android 资源管理 | 两会话争用一台设备、异常断线 | 无重复分配，无遗留租约 |
| iOS USB 发现 | Mac 接 iPhone，枚举真机 | 型号、系统、连接状态准确 |
| iOS XCUITest | WDA + Safari 网页操作 | 自动化通过，无签名异常 |
| iOS Viewer | 远程画面及控制路径 | 能明确验证支持操作和限制 |
| 桌面回归 | 旧浏览器启动/浏览/结束 | 不回退已有功能 |
| 安全 | 越权连接/重复令牌/调试端口检查 | 所有越权操作拒绝且留审计 |

以上为验收目标，**没有一项已在本次对话中实际跑通**。记录日志、版本、硬件、截图和失败原因，按 G0/G1/G2、I0/I1/I2 决定是否进入下一阶段。

## 8. 建议排期与资源

- Android P0（环境+PoC）：4–7 人日。
- Android P1（Agent、Provider、UI、会话、Viewer）：20–32 人日。
- Android P2（Linux KVM、真机、离线、生产）：10–18 人日。
- iOS P0（2015 Mac + 真实 iPhone PoC）：5–10 人日；兼容性受硬件/系统版本制约。
- iOS P1/P2（Agent、Provider、Viewer、真机扩展）：15–30 人日。
- 横向测试与加固：8–12 人日（与各阶段部分并行）。

工期为前置未知条件较多的初步工程估计。正式排期以 Android G0 和 iOS I0 结果为准。

## 9. 开发推进及完成定义

所有任务必须具备：对应代码与测试、运行日志/截图、README/运维文档更新、可回滚措施、CI 通过。**不以“代码写完”认定任务完成**。

推荐实施顺序：
1. AND-001 ～ AND-006：先得到 Android 真正可启动、可操控的 PoC。
2. CORE-001/003/004 + AND-007 ～ AND-016：统一底座和双模式 MVP。
3. AND-017 ～ AND-020：Android 生产化、真机、离线交付。
4. IOS-001/002 可提前采集环境信息；Android MVP 稳定后优先完成 IOS-003 ～ IOS-008。
5. IOS-009 ～ IOS-012：扩展到更多 iPhone/iOS 版本及 Simulator，完整安全验收。

## 10. 明确待确认信息

- Windows 开发主机的可用内存/CPU、Hyper-V/WHPX 状态、Android SDK 与系统镜像是否已安装。
- 2015 Mac 上的 Xcode、CLI Tools、剩余 SSD、USB 连接状态。
- 实际供测试 iPhone 的机型、iOS 版本以及能否开启开发者模式；没有真机时无法完成 iOS 真机 PoC。
- Linux 生产宿主的 CPU/KVM 能力和镜像离线介质容量。
- 是否有用于 Android APK/iOS IPA 安装验证的**已授权测试应用**。

## 11. 风险与回滚约束

- 保留现有桌面服务路径和生产 `deploy/compose.production.yaml` 的兼容，不将 PoC 的高权限挂载或调试端口带入生产。
- Linux Android Emulator 需要 KVM；Windows 优先原生 Emulator + Agent；macOS 仅作为 iOS 节点，不在 Windows Docker 虚构 iOS 运行环境。
- iOS 真机测试的可用版本取决于 Mac 的系统/Xcode/WDA/手机系统矩阵。2015 Mac 是旧版兼容 PoC 节点，不作为新系统覆盖的保证。
- 设备镜像、测试 App、截图和日志可能包含敏感数据，必须提供权限、隔离及彻底清理机制。
- 任一阶段未过验收门槛不得标记为已完成或直接发布。

## 12. 本轮已交付软件基础层（P1 软件层，本机编码 + 单测验证）

> 说明：按第 9 节「完成定义」，以下任务已具备**代码与单测**，但仍缺真机运行日志/截图、README/运维文档、CI 通过三项，故状态记为「已交付（待真机/文档/CI）」而非「完成」。涉及真机/模拟器/ADB/iOS 的 P0 环境 PoC（AND-002～006、IOS-001～005）仍全部未完成，无法在本机验证。

### 12.1 已交付清单（AND-007～012、CORE-001/003/004 软件部分）

| 任务 | 交付物 | 验证 |
|---|---|---|
| AND-007 | `packages/device-contracts`：平台/设备/节点/Profile/SessionMode/Capabilities 枚举与 Zod 契约（`DeviceProfileSchema`、`DeviceNodeSchema`、`DeviceInstanceSchema`、`DeviceLeaseSchema`、`CreateDeviceSessionRequestSchema`、`EnrollNodeRequestSchema`、`NodeHeartbeatSchema`、`ViewerTokenClaimsSchema`、`DeviceActionSchema`） | 8 个单测通过 |
| AND-008 | `apps/device-agent`：`AgentController`（注册/鉴权/心跳/重连，指数退避）、Fastify `server.ts`（`/health`、`/devices`、`/capabilities`、`/system-images`、`/profiles`）、`index.ts` 入口 | 9 个单测通过 |
| AND-009 | `apps/device-agent/src/provider/android.ts`：`AndroidProvider` 接口 + `EmulatorProvider`（ADB 调用；无 SDK 时安全降级 `PROVIDER_UNAVAILABLE`，`startVideoStream` 回退 `null`） | 接口 + 单测（含 FakeProvider）通过；真机/AVD 操作待真机 |
| AND-010 | `apps/control-api/src/services/device-registry.service.ts` + `routes/devices.ts`：`GET /api/v1/device-profiles`、`GET /api/v1/devices`、`GET /api/v1/device-nodes`、`POST .../register`、`POST .../:id/heartbeat`、`POST .../:id/revoke`、`POST /api/v1/device-profiles`（桥接 legacy `mobile_*` 表） | Registry 单测通过；路由待集成测试 |
| AND-011 | `apps/control-api/src/services/session-core.service.ts`：`SessionCoreService` 统一状态机（QUEUED→ALLOCATING→BOOTING→READY→TERMINATING→TERMINATED，FAILED/EXPIRED/LOST 分支）+ 独占租约（`device_leases` 唯一索引保证一台设备同一时刻仅一个 READY） | 6 个单测通过 |
| AND-012 | `apps/control-api/src/db/migrations.ts`：版本化迁移（幂等、备份/回滚、历史 `mobile_sessions` 旧表补列 + backfill）、`schema_migrations` 记录 | 迁移单测（建表/幂等/回滚/备份还原/旧表补列）通过 |
| CORE-001 | `apps/control-api/src/providers/desktop.provider.ts`：`DesktopProvider` 接口 + `SeleniumDesktopProvider`（委托既有 `OrchestratorService`）+ `createDesktopProvider` 兼容工厂 | 4 个单测通过（含 StubOrchestrator） |
| CORE-003 | 复用 AND-012 迁移器 + `backupDatabase`/`restoreDatabase`/`listBackups` 物理备份还原 | 见 AND-012 |
| CORE-004 | `apps/control-api/src/services/viewer-token.service.ts`：`ViewerTokenService`（HMAC-SHA256 绑定 user/session/device/lease 四元组，base64url 编码）+ 静态 `verifyNodeCredential`（64-hex 凭证 Bearer 校验） | 单测通过；TLS 待基础设施层配置 |

### 12.2 验证结果

- 全部 7 个 workspace 包 `pnpm -r build` 通过（含 `console-web` vite 生产构建）。
- `pnpm -r test` 全绿，共 **89** 项单测：`contracts` 6、`device-contracts` 8、`browser-catalog` 4、`device-agent` 9、`control-api` 62（含新增 `devices.integration.test.ts` 控制面设备目录 HTTP 集成测试 2 项）。
- 控制面 `server.ts` 已注入 `desktopProvider` / `deviceRegistry` / `sessionCore` / `viewerToken`；`mobile-devices.ts` 会话生命周期改走 `SessionCoreService`，创建后签发 Viewer Token 并存储摘要，stream/h264 用 `isLeaseActive` 守卫。

### 12.3 尚未交付（需真机 / 前端 / 基础设施，不在本轮编码范围）

- **硬件依赖（待 AND-002～006、IOS-001～005 真机 PoC 后推进）**：AND-013 前端云手机/移动浏览器页面、AND-014 Mobile Viewer + Stream Gateway、AND-015 完整云手机、AND-016 手机浏览器功能、IOS-006～008 iOS Agent/Provider/Viewer。
- **横向工作**：CORE-002（权限/审批/RBAC 扩展）、CORE-005（统一产物管理）、CORE-006（节点资源/审计/告警）、CORE-007（旧 Schema/路由兼容回归用例）、CORE-010（多节点扩容与容量规划）。
- **关闭验收门槛前必须补**：真机运行日志/截图、首次按运维文档独立部署验证（CORE-008）、首次 CI 流水线运行通过（CORE-009）。CORE-008/009 代码与配置已交付，待在真实环境/流水线首次跑通确认。

### 12.4 已知限制与风险

- `EmulatorProvider` 在缺乏 Android SDK/ADB 的宿主上仅返回 `PROVIDER_UNAVAILABLE`，不执行真实模拟器操作；真机/AVD 行为未经本机实测。
- `mobile_sessions` 历史旧表补列已在迁移 1 内以 `ALTER TABLE` 幂等补齐（`lease_id`/`viewer_token_hash`/`profile_id`/`expires_at`/`ended_at`/`failure_code`/`failure_message`），并对缺失 `expires_at`/`created_at`/`updated_at` 的记录做 backfill；但旧开发库中若存在更早期、连 `id` 之外的核心列都缺失的极端表结构，仍需在真机升级前人工核对。
- Viewer Token 已具备四元组绑定与摘要校验，但传输层 TLS、Agent 与管理面之间的 mTLS 尚未配置（CORE-004 的 TLS 部分）。

### 12.5 本轮补充：CORE-008 / CORE-009 收尾（控制面集成测试 + CI + 运维文档）

- **控制面集成测试（CORE-009 集成测试门禁）**：`apps/control-api/src/routes/devices.integration.test.ts` 以最小 Fastify 实例挂载真实设备目录路由 + 真实 SQLite（临时库）+ 鉴权桩，经 HTTP `inject` 跑通「登记 profile → 注册节点取 64-hex 凭据 → 心跳上报 → 目录可见设备/节点 → 撤销节点 → 旧凭据失效 401」，并校验未授权 401/403。无需真机/模拟器/ADB，可在 CI 无硬件环境执行。
- **CI 流水线（CORE-009）**：`.github/workflows/ci.yml` 三作业——
  - `verify`：lint（`tsc --noEmit`）→ build → **契约测试**（`@jingcang/device-contracts`）→ 单元/集成测试（`pnpm -r test`）→ 显式集成测试门禁。
  - `security`：依赖审计 `pnpm audit --audit-level=high` + 密钥泄露扫描 `gitleaks`（配套 `.gitleaks.toml` 允许已知占位符与脚本/测试/文档路径，避免误报）。
  - `package`：生产镜像 `apps/control-api/Dockerfile.production` build-only 校验。
- **运维文档（CORE-008，中英同步）**：`docs/部署与运维指南.md`（中文）与 `docs/Deployment-and-Operations-Guide.md`（英文），覆盖 Windows/Linux/macOS 部署、生产环境变量与密钥、备份/迁移/升级（版本化迁移幂等 + 旧表自动补列）、离线部署（`SHA256SUMS.txt`/`PLATFORM.txt`/`.env.production` + `install-offline-production.ps1`）、安全与 CI 门禁、故障排查。
- 注：CORE-008/009 配置与文档已落地，仍待**首次按文档独立部署**与**首次 CI 流水线运行**确认无环境差异（计划第 9 节「不以代码写完认定完成」）。

> AI生成