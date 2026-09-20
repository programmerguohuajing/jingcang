# 镜舱（JingCang）部署指南

## 1. 前置条件

- Windows 11 + Docker Desktop / WSL2，或能够运行 Docker Compose 的等效环境。
- 本地开发需要 Node.js >= 20 与 pnpm >= 9。
- 推荐使用仓库声明的 pnpm 11.1.2。

## 2. 初始化

```powershell
pnpm install
.\scripts\bootstrap.ps1
```

`bootstrap.ps1` 会创建数据目录，并使用加密安全随机数替换 `.env` 中的 Secret 占位值。若 `.env` 已存在且 Secret 已有效，不会覆盖。

## 3. Docker Compose 一键部署（推荐）

```powershell
docker compose -f deploy/compose.yaml up -d --build
```

服务组成：

- `gateway`：唯一用户入口，默认 `127.0.0.1:8088`。
- `control-api`：Fastify API + React 静态资源；为管理员在线增加浏览器版本而挂载 Docker Socket。
- `selenium-docker`：Selenium Dynamic Grid，同样挂载 Docker Socket 以动态创建会话容器。

浏览器镜像由 Dynamic Grid 根据会话按需启动。Docker Compose 模式下 SQLite 使用名为 `jingcang_db` 的 Docker volume，并保持 WAL；首次从旧版升级时，如果 volume 为空，会自动从宿主机 `data/db` 迁移现有数据库。本机直接运行仍使用 `data/db`。

验证：

```powershell
.\scripts\verify.ps1
```

然后访问 `http://localhost:8088`，用户名为 `admin`。初始密码在首次运行 `bootstrap.ps1` 时输出，并保存在本机 `.env`。

## 4. 本地开发模式

先通过开发覆盖文件启动 Dynamic Grid，并按需把 Grid 暴露到宿主机：

```powershell
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml up -d selenium-docker
```

默认绑定宿主机 `127.0.0.1:4444`。如果该端口已被其它 Selenium/PoC 占用，可先设置 `JINGCANG_GRID_HOST_PORT` 为其它空闲端口，并同步把本地 Control API 的 `JINGCANG_GRID_URL` 指向该端口。

再运行本地 Control API：

```powershell
pnpm build
node apps/control-api/dist/server.js
```

非容器模式下，如果 `.env` 中的 Grid 地址仍为 `http://selenium-docker:4444`，Control API 会自动转换为 `http://127.0.0.1:4444`。

前端热更新可单独运行：

```powershell
pnpm --filter @jingcang/console-web dev
```

Vite 会把 `/api`、`/health` 和 Viewer WebSocket 代理到本地 Control API。

## 5. 局域网暴露

默认不要修改回环绑定。需要局域网访问时，应同时配置受控的网关监听、防火墙规则和 `JINGCANG_LAN_ACCESS_ENABLED=true`。不要直接向公网暴露 4444、5900 或 7900。

## 6. 发布前校验

```powershell
pnpm build
pnpm lint
pnpm test
pnpm audit --prod
docker compose -f deploy/compose.yaml config -q
```
