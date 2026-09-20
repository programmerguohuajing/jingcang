# 镜舱（JingCang）常见故障排查手册

## 1. `/health/live` 正常，但 `/health/ready` 返回 503

`ready` 同时检查 SQLite 和 Selenium Grid。先执行：

```powershell
docker compose -f deploy/compose.yaml ps
Invoke-RestMethod http://127.0.0.1:4444/status
```

如果 Grid 未就绪，检查 `selenium-docker` 日志和 Docker Desktop 状态。

## 2. 创建测试舱后状态变为 FAILED

Control API 现在只有在 Selenium Grid 真正返回 WebDriver `sessionId` 后才会进入 READY，不再创建假会话。

检查：

```powershell
docker compose -f deploy/compose.yaml logs --tail=200 selenium-docker
docker compose -f deploy/compose.yaml logs --tail=200 control-api
```

确认浏览器镜像能够从 Docker Hub 拉取，并且 Docker Desktop 有足够磁盘和内存。

## 3. 无法访问本机开发服务

容器里的 `localhost` 指向浏览器容器自身。控制台和 API 会自动将以下地址转换为 `host.docker.internal`：

- `localhost`
- `127.0.0.1`
- `::1`

如果仍无法访问，确认宿主机开发服务允许来自 Docker Desktop 虚拟网络的连接。部分开发服务器需要监听 `0.0.0.0`。

## 4. noVNC 画面无法连接

Viewer Token 默认只有 120 秒有效期，控制台断线后会重新申请 Token。

依次确认：

1. 会话状态为 `READY`。
2. `GET /api/v1/sessions/{id}/viewer-token` 能正常返回。
3. Nginx `/viewer/` WebSocket Upgrade 配置正常。
4. Selenium Grid 支持 `/session/{seleniumSessionId}/se/vnc`。
5. 浏览器容器未被 Docker Desktop 手动终止。

## 5. 浏览器测试舱被自动关闭

自动关闭有两种不同语义：

- 只有当前时间达到或超过 `expires_at` 时，会话才会进入 `EXPIRED / 已过期`。
- READY 会话超过 `JINGCANG_SESSION_IDLE_MINUTES` 没有 Viewer 交互时，会被空闲回收并进入 `TERMINATED / 空闲回收`，不会标记为已过期。

Control API / 容器重启时，会为仍未到期的 READY 会话重新建立空闲计时基线，避免使用重启前的旧活动时间立即回收。设置 `JINGCANG_SESSION_IDLE_MINUTES=0` 可关闭空闲回收，但仍保留最大会话时长限制。

## 6. 登录失败或出现 429

登录接口默认每 IP 每分钟最多 10 次请求。连续失败后等待限流窗口结束再重试。

如果刚修改过密码，旧 Cookie 会自动失效，需要重新登录。

## 7. Control API 启动时报 Secret 配置错误

系统不会再使用固定默认密钥。运行：

```powershell
.\scripts\bootstrap.ps1
```

如果 `.env` 仍包含 `change-me-*` 占位值，脚本会使用加密安全随机数自动替换。

## 8. 产物访问返回 403 / 404

`/artifacts/*` 不是公开静态目录。只有会话所有者和管理员能够访问数据库已登记的产物。

如果数据库有记录但文件缺失，检查 `data/artifacts`、保留天数以及容量上限清理策略。
