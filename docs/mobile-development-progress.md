# JingCang 移动测试平台开发记录

## 2026-10-08 · Android 独立开发阶段

分支：`feat/mobile-device-cloud`

### 已完成并验证
- 独立 `jingcang-mobile-dev` Docker Compose：`127.0.0.1:28088`，独立网络和数据卷，不覆盖原 `8088` 环境。
- Windows Android Agent：ADB 枚举已启动的 Android 模拟器、基本设备属性、PNG 截图、HOME/BACK/APP_SWITCH、点击/滑动及受限 Chrome URL 导航。
- Agent API 使用独立令牌，未认证请求拒绝；密钥位于 Git 忽略的 `deploy/.env.mobile-agent` 中。
- Fastify 移动设备 API：设备列表、独占会话创建、我的会话、截图、动作、结束会话、空闲超过两小时回收。
- Web 移动设备页：设备发现、完整云手机/浏览器两种模式、基于定时截图的画面、点击/滑动、导航按键及受限英文/数字输入。
- `pnpm lint`、`pnpm test`（26 项）、`pnpm build` 均通过；Docker Compose 构建运行成功。
- HTTP 冒烟测试：登录、在线设备发现、独占占用冲突返回 409、截图 Content-Type、会话结束均通过。

### 当前实现边界
- 当前 PoC 借用已有在线 `emulator-5554`（Android 7.0），没有完成新镜像安装、不同系统版本自动建机、动态开机与关机。
- Viewer 当前为约 1.8 秒/帧的截图刷新，不是视频流；长按、连续拖动、输入法和低延迟尚未完成。
- 尚未实现 APK 安装/上传、Appium 自动化、Android 真机兼容性验证、Linux KVM 与离线移动镜像。
- Agent 当前通过 Windows 本机绑定端口向 Docker 开发 API 提供服务；使用前需运行 `scripts/run-android-agent.ps1`，生产必须进一步限制网络来源并采用强认证/TLS。
- iOS 真机、macOS Agent 与 Xcode/WebDriverAgent 尚未开始运行验证，需要 Mac 和实际 iPhone 接入。

### 启动与验证
```powershell
Set-Location D:\codex\jingcang
powershell -ExecutionPolicy Bypass -File .\scripts\run-android-agent.ps1
docker compose -f deploy/compose.mobile-dev.yaml up -d --build
powershell -ExecutionPolicy Bypass -File .\scripts\test-mobile-smoke.ps1
```
访问：`http://127.0.0.1:28088/mobile`。需要先登录该开发环境账号。

### 2026-10-08 · 应用管理增强
- Windows Android Agent 新增已安装第三方 App 查询，按包名校验后执行 App 启动和停止。
- Control API 新增已授权移动会话的 App 列表接口，沿用会话所有者权限检查。
- 移动设备页面新增 App 清单、启动、停止按钮。
- 独立 Docker 开发环境重新构建成功，端到端验证读取到 6 个第三方 App；基础会话与浏览器冒烟测试继续通过。
- **尚未实现 APK 上传安装/卸载和 Appium；新增加的启动/停止按钮还需人工交互验收。**

### 2026-10-08 · APK 安装 PoC
- 移动会话新增 APK 上传及安装入口：限制大小 8MB，验证 ZIP/APK 标记，后端检查会话所有权并通过受保护的 Agent 转发。
- Windows Agent 采用独立临时目录执行 ADB 安装，结束后删除临时文件；不允许由调用者指定宿主文件路径或命令。
- 端到端冒烟测试通过非法 APK 拒绝；**真实 APK 安装成功仍待使用已授权兼容测试包验收**。
- 本机系统镜像仅发现 Android 4.4～8.1 部分镜像，Android 14 和 Appium 尚未配置；不宣称对应版本已实现。

### 2026-10-08 · AVD 配置发现
- Agent 新增只读 AVD 配置目录及 Android API Level 检测；控制台显示已安装配置，不擅自启动或覆盖已有模拟器。
- 真实宿主机返回 3 个 AVD 配置：Android_5_0_API21、Android_7_0_API24、Pixel_2；Docker API 经过认证的端到端查询通过。
- 尚待实现：选择已有 AVD 一键启动/关闭、Android 14 镜像安装/创建、跨节点资源调度。

### 2026-10-08 · AVD 生命周期控制接口
- Windows Agent 新增对已安装 AVD 的受控启动、停止操作；仅允许已发现 AVD，且最多管理一台由当前 Agent 启动的模拟器。
- 只允许停止当前 Agent 管理的进程，不接管或终止手动启动的模拟器。
- Control API 仅管理员可调用，停止前检查设备租约；Web 控制台新增启动/停止入口。
- 非破坏性集成测试验证不存在的 AVD 返回 404、已运行的 Android_7_0_API24 重复启动返回 409；桌面浏览器及既有 Android 模拟器未被主动停止。
- **新的 AVD 成功冷启动/停止尚未做真实运行测试**；Agent 进程重启后的托管恢复、并发端口分配和生产级调度仍待实现。

### 2026-10-08 · Android AVD 冷启动实测通过
- 修复 Agent 托管进程跟踪方式：维护 child/startedAt/status，AVD 列表展示启动中、已就绪和超时状态。
- 停止前核对 `emulator-5580` 的 AVD 名称；对于启动完毕的模拟器使用 `adb emu kill` 正常关机；不触碰其他端口或非托管实例。
- 修复控制台模拟器启停 POST 的 JSON Content-Type，避免 Fastify 返回 415，并显示运行状态。
- **实际验收**：由 JingCang 控制 API 分别冷启动 `Android_5_0_API21` 和 `Pixel_2`，两次均达到 READY、成功停止，随后 ADB 枚举仅余原来的 `emulator-5554`，未影响它。
- 一个 Android 7.0 会话已在数据库中占用设备，因此常规重复创建被正确拒绝；未强制清理他人/历史活动会话。
- 仍待：Agent 重启后的托管状态恢复、镜像版本自动下载、Appium、真正的视频传输、生产资源配额及 iOS 接入。

### 2026-10-08 · Agent 启停互斥与恢复状态增强
- Agent 增加 AVD 生命周期指令互斥，拒绝在上一条启停请求尚在处理时重复操作，避免竞争同一模拟器端口。
- Agent 重新启动后若检测到 emulator-5580 已在运行但当前 Agent 未托管该进程，设备目录标为 external，前端禁用误导性的“启动”按钮；不会尝试停止外部进程。
- 完成 lint、26 项单元测试、build、独立 Docker 重建与健康检查。
- 现有 emulator-5554 已被活跃会话占用，端到端脚本会如实输出 DEVICE_IN_USE_SKIP_SESSION_SMOKE，不自动抢占或回收他人会话。
- 注意：还没有验证对正在启动中的 Agent 进程进行强制重启的全流程恢复；生产级租约、持久化节点注册、心跳仍待实现。

### 2026-10-08 · Android 自动化能力诊断
- 新增 Windows Agent `/capabilities`：通过只读 ADB 查询设备 API Level、ABI、安全补丁级别和 Chrome 是否安装。
- Control API 新增需认证的 `/api/v1/mobile/capabilities`，控制台移动设备页增加自动化环境诊断区。
- 本机未检测到 Appium 可执行命令，自动化状态明确标识 `automationReady=false`，不能宣称 Appium 脚本已可执行。
- Lint、26 项单元测试和 Build 通过，独立 Docker 重新构建。端到端确认 1 台设备返回能力诊断，接口成功；原有设备由活动会话占用，测试脚本安全跳过创建新会话。
- 待执行：Appium 工具链安装与 UiAutomator2 驱动兼容性测试、真实网页自动化脚本、安卓新系统镜像管理、实时流媒体、iOS Mac Agent。

### 2026-10-08 · Appium 与 Android Chrome 自动化实测及平台接入
- 在 `D:\\codex\\jingcang-mobile-toolchain` 独立安装 Appium 3.8.0；在 `D:\\codex\\jingcang-mobile-appium-home` 安装 UiAutomator2 8.7.0 驱动。Android Studio JBR 25 被复用，无需修改全局 JAVA_HOME。
- Appium Doctor：**0 required fixes**，另有 3 项可选依赖（bundletool、ffmpeg、GStreamer）待完善。
- 测试设备 Pixel_2：Android 8.1/API27，Chrome 101；另装匹配官方 ChromeDriver 101.0.4951.41，位于独立 toolchain 目录，不改原来 Selenium 浏览器镜像。
- **实际成功**：Appium 原生 UiAutomator2 session 创建、页面 UI 树读取、Chrome WebDriver session 创建、打开 https://example.com 页面。`scripts/test-appium-android.mjs` 返回 TEST_NATIVE=true / TEST_CHROME=true。
- 开发分支增加 `scripts/android-webdriver-automation.mjs`（预设公开页面 smoke，不接受任意内网 URL），Agent `/devices/:serial/automation`，受权限保护的 Control API `POST /api/v1/mobile/sessions/:id/automation`，浏览器模式的前端执行按钮。
- 仅移动开发环境使用 `deploy/nginx/nginx.mobile-dev.conf`，为较长的 Appium 调用设置超时；原有 `deploy/nginx/nginx.conf` 和 8088 环境不改动。
- 新增 `scripts/setup-mobile-appium.ps1` / `run-mobile-appium.ps1` / `test-appium-integration.ps1`，记录可复现安装及测试流程。
- **平台端到端仍未通过最终验收**：第一次调用因 ChromeDriver 内部 ADB 命令超时及原 Nginx 60 秒超时返回 504；后续修复代理超时后，设备出现另一条 READY 租约（并非已释放的测试会话），未擅自删除该租约，因此无法重新分配。同一期间 Agent 启动 Pixel_2 有一次提前退出，已加强失败状态记录，但需继续复验。
- 后续优先补齐：工具链/Agent 启动的持久化与回收、异步自动化任务/超时、安全隔离、Android 新系统版本镜像、低延迟画面，然后 Android 真机与 iOS Mac Agent。

### 2026-10-08 · AVD 启动器退出状态排查与保护
- 修复 Windows Android Agent 在 GUI 启动器退出时误判 QEMU 已失败的问题：优先通过 ADB 判断指定端口设备是否已启动；启动器退出并不直接意味着 Android 虚拟机退出。
- AVD 子进程恢复为独立标准流（stdio ignore），避免 headless agent 管道长期持有或进程输出影响；保留启动异常状态和启动超时检测。
- 已验证 `node --check`、全项目 Lint、26 项单元测试、Build 全部通过；重启受令牌保护的 Agent 成功。
- 当前 `emulator-5580` 历史 READY 租约的持有情况需要确认，**本次没有强行释放租约或重启已分配设备**；完整冷启动及自动化链路复测仍待可独占设备时完成。Android Studio/旧版镜像长启动与 ChromeDriver ADB 超时仍有生产化风险。

### 2026-10-08 · Android 系统镜像目录与版本能力检测
- Windows Agent 新增只读 `/system-images`：安全扫描 Android SDK 系统镜像目录，仅列出存在 `system.img` 的已安装镜像，无远程下载或修改操作。
- Fastify 增加需登录认证的 `/api/v1/mobile/system-images`，Web 控制台增加 Android 系统镜像列表，明确目前还不能自动下载安装新版本。
- 本机实测镜像：API 19/google_apis/x86、API 21/google_apis/x86_64、API 24/google_apis_playstore/x86、API 27/google_apis_playstore/x86；**没有 Android 14（API 34）**。
- Docker 到 Windows Agent `SYSTEM_IMAGES_HTTP=200`，镜像清单与本机实际文件一致；Lint、26 项单测、Build 成功，独立 Docker 重建成功，两套网关 `28088/8088` 均返回 HTTP 200。
- 待开发：Android 14 镜像获取/离线缓存、创建 AVD 的 API 与调度、低延迟画面、iOS 真机。

### 2026-10-08 · 已安装 Android 镜像的受控 AVD 创建与回收
- Agent 新增受控创建/删除：仅使用已安装的 Android API 24/27 Google Play x86 镜像，基于现有 Pixel_2 硬件配置生成隔离的 `JingCang_Test_API24_x86` 或 `JingCang_Test_API27_x86`；不使用不受控名称或任意本机路径。
- 创建目标存在时直接返回 409；删除要求有 `.jingcang-mobile-managed` 标记，并拒绝删除运行中的 AVD，不改变原有配置。
- Control API 创建和删除接口均要求管理员权限，控制台提供创建测试 AVD 和删除 JingCang 测试 AVD 按钮。
- **实际验收：** API 24 与 API 27 两套配置均通过 CREATE/DISCOVERY/DELETE；不支持的 API 34 返回 400，原有 `Pixel_2` 的删除请求返回 400；测试后 `emulator -list-avds` 仍然只显示原来的三个配置。
- **仍待验收：** 由新生成的 AVD 成功冷启动并运行，磁盘配额与多实例调度、Android 14 系统镜像安装及 UI 人工操作。当前后端采用固定名字/单实例安全边界，不是完整的自动设备工厂。

### 2026-10-08 · 托管设备启动与活动租约冲突保护
- 修复固定端口 emulator-5580 的资源保护：控制 API 对受控 AVD 的启动和停止都检查未过期的 READY 会话；设备被租用时返回 409 DEVICE_BUSY，避免抢占其他用户。
- 仅在本次移动开发 Docker 数据库内更新租约到期状态，不接触原 8088 平台。
- Lint 已通过，其他动态测试依据独立开发环境可用性继续执行。

### 2026-10-08 · 新 AVD 冷启动预检与活动会话保护
- 追加 `scripts/test-mobile-avd-create.ps1` 的可选 `JINGCANG_TEST_COLD_BOOT=1` 冷启动流程：使用临时测试 AVD，轮询 Agent 生命周期、尝试正常关机，只有不冲突时执行；测试脚本不会覆盖已有 AVD。
- **本次真实检查**：API27 的 JingCang_Test_API27_x86 已存在，保护规则拒绝覆盖；API24 配置成功创建、发现和删除，但由于 emulator-5580 仍有 READY 会话，启动被正确返回 409 DEVICE_BUSY。后续改为测试前先检查租约，输出 `AVD_COLD_BOOT_SKIPPED_DEVICE_BUSY=PASS` 而不误报启动成功。
- 控制台在存在 emulator-5580 READY 会话时禁用 AVD 启停按钮，避免误操作。没有主动释放已有租约，没有结束原 emulator-5554。
- TypeScript Lint 和 26 项单元测试通过；**新建 AVD 的实际启动尚未验证通过**，本次不能将自动开机任务标记完成。

### 2026-10-08 · 连续画面 MJPEG 试验通道
- Fastify 增加受登录与移动会话所有权验证的 `GET /api/v1/mobile/sessions/:id/stream`，以 multipart/x-mixed-replace 返回连续 PNG 截图，启用 no-store 与代理禁用缓冲。流长最多 100 秒，服务端会在断开连接后停止轮询，进行背压控制。
- 移动端控制台新增“开启连续画面（MJPEG）”切换，可退回原有每 1.8 秒的定时截图，90 秒重建连接；底层仍复用受令牌保护的 Windows Agent，不暴露未认证的宿主 API。
- Lint、26 项现有单元测试、Build 均通过。增加 `scripts/test-mobile-stream.mjs`，在本机已有活动会话上只检查帧格式、不保存画面：实际 `STREAM_HTTP=200`、`multipart/x-mixed-replace`、`MJPEG_FIRST_PNG=PASS`，首帧约 448ms；未登录请求返回 401，两套独立网关均 HTTP 200。
- **MJPEG 仍是连续 PNG 截图，不是 scrcpy/H.264/WebRTC 低延迟编码视频**；多人并发、持续传输帧率、实际触控延迟、断线恢复与长时间稳定性仍待验收，不能将低延迟流媒体任务标记完成。

### 2026-10-08 · P0/P1/P2 继续推进：应用控制、租约状态、Linux KVM 预检
- Android Agent 新增 `uninstallApp`，先以 `pm list packages -3` 验证确为已安装第三方应用，再执行 ADB 卸载。拒绝不存在/系统 App，测试中对不存在包返回 403，未删除任何真实应用。新增 `rotate` 横竖屏操作，UI 增加旋转按钮；横竖屏实际交互测试仍待独立空闲设备验收。
- Web 设备列表中加入可用/已租用状态。Control API 在 `/api/v1/mobile/devices` 查询当前 READY 租约，前端禁用已占用设备的云手机/浏览器模式创建按钮。继续使用数据库唯一索引作为并发独占保障。
- P2 新增 `scripts/check-linux-android-kvm.sh` Linux 主机 KVM、CPU 虚拟化标志、剩余存储、Android SDK 镜像目录预检。**当前独立 Docker 容器实测 `/dev/kvm` 缺失**、CPU 虚拟化标志存在，返回 `ANDROID_KVM_EMULATOR_READY=false`，退出码 2。Linux KVM 模拟器生产部署目前不具备条件，不能标记完成。
- 全项目 Lint、26 项单元测试、构建通过；独立开发环境部署情况及接口回归记录以当前实测为准。
- 仍未完成：P0 Android 14 镜像及新设备冷启动、APK 安装/卸载实测、H.264/WebRTC 低延迟链路；P1 设备 Agent 注册与心跳、多节点租约调度、正式权限/审计；P2 Linux KVM 设备权限与生产容器、真机池、离线镜像包、可靠性及压力测试。

### 下一阶段任务
优先 AND-003/004/005/006 的剩余部分：Android 14 等镜像、自动建机、实时流媒体与 Appium。随后 AND-007～016 的正式 Provider、会话资源调度、权限与独立 Agent 注册体系。之后处理 Linux KVM/真机/离线，最后 iOS 真机。
