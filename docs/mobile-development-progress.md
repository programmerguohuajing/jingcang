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

### 下一阶段任务
优先 AND-003/004/005/006 的剩余部分：Android 14 等镜像、自动建机、实时流媒体与 Appium。随后 AND-007～016 的正式 Provider、会话资源调度、权限与独立 Agent 注册体系。之后处理 Linux KVM/真机/离线，最后 iOS 真机。
