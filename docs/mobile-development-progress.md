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

### 下一阶段任务
优先 AND-003/004/005/006 的剩余部分：Android 14 等镜像、自动建机、实时流媒体与 Appium。随后 AND-007～016 的正式 Provider、会话资源调度、权限与独立 Agent 注册体系。之后处理 Linux KVM/真机/离线，最后 iOS 真机。
