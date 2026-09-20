# 镜舱（JingCang）安全设计说明

## 1. 网络边界

- Gateway 默认绑定 `127.0.0.1:8088`。
- 推荐的主 Compose 不向宿主机暴露 Selenium Grid；仅本地开发覆盖文件按需绑定到宿主机 `127.0.0.1`。
- 浏览器容器的 VNC/noVNC 原始端口不直接暴露给用户。
- 非容器本地运行时，`JINGCANG_LAN_ACCESS_ENABLED=false` 会拒绝非回环地址监听。
- Control API 不启用跨来源 CORS，Web Console 与 API 使用同源访问。

## 2. 登录与会话认证

- 密码使用随机盐 + scrypt 存储；登录校验使用异步 scrypt，避免阻塞 Node 事件循环。
- 登录接口限制为每 IP 每分钟最多 10 次请求。
- 登录凭证只写入 HTTP-Only Cookie，不再把 bearer token 返回给前端 JavaScript。
- HTTPS Base URL 下 Cookie 自动启用 `Secure`，并使用 `SameSite=Lax`。
- 用户修改密码后，旧登录 Token 因 `authVersion` 变化立即失效。
- HMAC Token 签名使用恒定时间比较。

## 3. Viewer Token

- Viewer 使用独立的短期 HMAC-SHA256 Token，默认 TTL 为 120 秒。
- Token 绑定 `sessionId` 和签发用户，并且只能用于 `scope=viewer`。
- WebSocket 建连时 Token 通过 `Sec-WebSocket-Protocol` 子协议传递；服务端仍保留查询参数兼容读取，但控制台不再生成带 Token 的 URL。
- 只有处于 `READY` 状态的测试舱可以签发 Viewer Token。

## 4. Docker 隔离

- Control API 与 Selenium `standalone-docker` Dynamic Grid 控制组件需要挂载 Docker Socket；这是“在线增加浏览器版本”和动态创建浏览器容器的受信任控制面边界。
- 在线增加版本仅允许管理员调用，接口限制为每小时最多 5 次，并且同一时间只允许一个安装任务。
- 客户端不能提交任意镜像地址：后端只接受 Chrome、Edge、Firefox、Chromium 四个厂商，并映射到固定的 Selenium 官方 `standalone-*` 仓库；版本标签执行长度与字符白名单校验。
- 动态节点使用 `com.jingcang.managed=true` 标签，并只连接镜舱后端 Docker 网络。
- 浏览器会话使用 Selenium 官方临时容器，由 Grid 创建和回收。
- 浏览器容器不挂载镜舱源码、SQLite 数据库或宿主机 Docker Socket。

## 5. 产物访问

- `/artifacts/*` 不再是公开静态目录。
- 每次读取都会验证当前用户是否为会话所有者或管理员。
- 文件路径解析后必须仍位于 `data/artifacts` 内，防止路径穿越。
- Worker 删除产物时使用相同的目录边界校验。
- 响应使用 `Cache-Control: private, no-store` 与 `X-Content-Type-Options: nosniff`。

## 6. Secret 与配置

- `JINGCANG_SESSION_SECRET`、`JINGCANG_VIEWER_SECRET` 和初始管理员密码没有代码内固定 fallback。
- 缺失、过短、仍是 `change-me-*` 占位值，或命中旧版本固定默认值时，Control API 拒绝启动。
- `bootstrap.ps1` 使用系统加密随机数生成器创建 Secret。
- 端口、并发数、队列长度、会话时长、产物容量和 Token TTL 均执行范围校验。

## 7. 依赖与安全 Header

生产依赖通过 `pnpm audit --prod` 检查。Control API 默认发送 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。
