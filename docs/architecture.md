# 镜舱（JingCang）系统架构设计说明书

## 1. 架构概览

镜舱采用同源 Web Console + Control API + Selenium Dynamic Grid 的本地化架构：

```text
用户浏览器
    │ http://localhost:8088
    ▼
Nginx Gateway
    │
    ▼
Control API (Fastify)
    ├── SQLite：用户、浏览器目录、会话、产物索引、审计
    ├── AuthService：HTTP-Only Cookie / HMAC Token
    ├── CatalogService：浏览器矩阵
    ├── OrchestratorService：会话状态机与 Grid WebDriver
    ├── Viewer Gateway：短期 Token + VNC WebSocket 双向代理
    ├── Artifact Route：按会话归属鉴权访问产物
    └── WorkerService：队列恢复、到期/空闲回收、产物清理
             │
             ▼
Selenium Standalone Docker (Dynamic Grid)
    ├── Docker API（仅 Dynamic Grid 控制组件可访问）
    ├── 按会话创建 Chrome 容器
    ├── 按会话创建 Edge 容器
    └── 按会话创建 Firefox 容器
```

Control API 与 Selenium Dynamic Grid 控制组件都位于受信任控制面并挂载 Docker Socket：前者只为管理员从固定的 Selenium 官方镜像仓库增加版本节点，后者用于按需创建和回收会话容器。普通浏览器容器不会获得 Docker Socket。

## 2. 会话状态机

正常流程：

`QUEUED / PROVISIONING → STARTING → READY → TERMINATING → TERMINATED`

异常流程：

- `FAILED`：Grid 不可用、WebDriver 创建失败或浏览器舱位无效。
- `EXPIRED`：达到会话 TTL 或超过空闲超时。
- `LOST` / `ORPHANED`：保留在协议枚举中，目前不由 Worker 主动产生。

只有 Selenium Grid 真正返回 `sessionId` 后，测试舱才会进入 `READY`。不存在 mock/standalone 假会话 fallback。

## 3. Viewer 链路

前端直接使用本地打包的 `@novnc/novnc` RFB 客户端。Viewer Token 由 Control API 签发，默认有效期 120 秒，并通过 WebSocket 子协议发送，避免令牌出现在代理访问日志的 URL 查询串中。

Control API 校验 Token 与 `sessionId` 后，将浏览器 WebSocket 双向代理到 Selenium Grid 的 `/session/{seleniumSessionId}/se/vnc`。

## 4. 本机开发服务连通性

用户输入 `localhost`、`127.0.0.1` 或 `::1` 时，Control API 会将目标地址转换为 `host.docker.internal`，使浏览器容器能够访问 Windows/macOS 宿主机上的开发服务。

## 5. 后台维护

Worker 每 30 秒执行一次维护：

- 仅在达到 `expires_at` 时将会话标记为 `EXPIRED`；
- 根据 `JINGCANG_SESSION_IDLE_MINUTES` 回收空闲 READY 会话，并标记为 `TERMINATED / IDLE_TIMEOUT`；
- 服务启动时为未到期 READY 会话重置空闲计时基线，再恢复并消费 QUEUED 会话；
- 根据保留天数清理过期产物；
- 根据 `JINGCANG_ARTIFACT_MAX_TOTAL_GB` 按创建时间淘汰最旧产物。
