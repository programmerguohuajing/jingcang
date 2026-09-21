# 镜舱（JingCang）生产化部署流程

> 本文档用于正式环境构建、部署、升级和回滚。开发环境请继续使用 `docs/deployment.md`。

## 1. 生产部署目标

生产部署使用以下专用文件：

- `apps/control-api/Dockerfile.production`：多阶段生产镜像，仅保留运行时依赖与构建产物。
- `deploy/compose.production.yaml`：生产 Compose，启用健康检查、只读根文件系统和独立持久化卷。
- `deploy/selenium/docker.production.toml`：生产 Dynamic Grid 配置，浏览器镜像按 digest 固定。
- `deploy/selenium/browser-catalog.production.yaml`：生产浏览器矩阵，仅包含 Chrome / Edge / Firefox 稳定入口，不引用 PoC 端口。
- `deploy/.env.production.example`：生产环境变量模板。
- `scripts/bootstrap-production.ps1`：生成生产环境配置与随机 Secret。
- `scripts/build-production.ps1`：统一生成带版本和 Git revision 标签的 Control API 生产镜像，并默认联动构建浏览器离线 bundle。
- `scripts/build-browser-bundle.ps1`：把当前预置的 Selenium 浏览器镜像按共享 layer 打成 `jingcang/browser-bundle:<version>`。
- `deploy/browser-bundle/images.txt`：定义需要内置到生产浏览器 bundle 的镜像清单。

生产部署不会复用开发数据库卷，默认使用：

- `jingcang_prod_db`：SQLite 数据。
- `jingcang_prod_artifacts`：截图、录像等测试产物。
- `jingcang_prod_logs`：服务日志目录。

## 2. 前置条件

- Docker Engine / Docker Desktop，支持 Docker Compose v2。
- Windows 推荐 Docker Desktop + WSL2；Linux 可直接使用 Docker Engine。
- 构建机需要能够访问 npm registry、Docker Hub 和 Selenium 官方镜像仓库。
- 生产主机需要足够的 CPU、内存与磁盘空间承载并发浏览器容器。

建议至少：4 CPU、8 GB RAM、30 GB 可用磁盘。浏览器并发较高时应按每个节点约 2 CPU / 2~3 GB RAM 额外规划。

## 3. 获取代码并确认版本

```powershell
git clone https://github.com/programmerguohuajing/jingcang.git
cd jingcang
git checkout main
git pull --ff-only
git status
```

生产构建前工作区应保持干净，并记录当前 revision：

```powershell
git rev-parse HEAD
```

## 4. 初始化生产环境配置

Windows：

```powershell
.\scripts\bootstrap-production.ps1
```

脚本会创建 `deploy/.env.production` 并生成：

- `JINGCANG_SESSION_SECRET`
- `JINGCANG_VIEWER_SECRET`
- `JINGCANG_ADMIN_INITIAL_PASSWORD`

`deploy/.env.production` 已被 `.gitignore` 排除，禁止提交到 Git。

生产环境初始管理员用户名固定为 `admin`。初始密码来自 `JINGCANG_ADMIN_INITIAL_PASSWORD`，由 `bootstrap-production.ps1` 首次生成并写入 `deploy/.env.production`。脚本首次执行时会同时在终端显示该密码。首次生成后应立即将管理员初始密码保存到密码管理器，并在首次登录后修改管理员密码。若数据库中已经存在用户，仅修改该环境变量不会重置现有管理员密码。

## 5. 配置生产入口

编辑 `deploy/.env.production`：

```dotenv
JINGCANG_IMAGE_TAG=1.2.0
JINGCANG_BIND_HOST=0.0.0.0
JINGCANG_PORT=8088
JINGCANG_BASE_URL=https://jingcang.example.com
JINGCANG_PUBLIC_HOSTNAME=jingcang.example.com
JINGCANG_TIMEZONE=Asia/Shanghai
JINGCANG_LAN_ACCESS_ENABLED=true
```

### 5.1 默认局域网访问

生产部署默认开启局域网访问：

```dotenv
JINGCANG_BIND_HOST=0.0.0.0
JINGCANG_LAN_ACCESS_ENABLED=true
JINGCANG_TRUST_PROXY=true
```

同一局域网内可通过生产主机 IP 和配置端口访问，例如 `http://192.168.1.100:8088`。仍需确保宿主机防火墙允许对应 TCP 端口。

### 5.2 如需限制为仅本机访问

显式设置：

```dotenv
JINGCANG_BIND_HOST=127.0.0.1
JINGCANG_LAN_ACCESS_ENABLED=false
```

公网环境必须在外层配置 TLS。不要直接把 Selenium 4444、VNC 5900/7900 或 Docker API 暴露到公网。

## 6. 构建生产镜像

推荐通过构建脚本：

```powershell
.\scripts\build-production.ps1
```

默认根据根目录 `package.json` 构建两个生产镜像：

```text
jingcang/control-api:1.2.0
jingcang/browser-bundle:1.2.0
```

其中 `browser-bundle` 只内置构建时本机的 Chrome Latest / Edge Latest / Firefox Latest。构建时会先校验 `deploy/browser-bundle/images.txt` 中的三个镜像都已存在，然后执行一次 `docker save`；共享 layer 只保存一次，再封装到 bundle 镜像中。首次 preload 需要解包约 1~2 GB 数据，耗时取决于生产机磁盘性能。其他历史或指定版本仍可在生产机具备互联网出站能力时，通过“新增浏览器版本”在线拉取。

自定义仓库与标签：

```powershell
.\scripts\build-production.ps1 `
  -ImageRepository ghcr.io/programmerguohuajing/jingcang `
  -Tag 1.2.0 `
  -TagLatest
```

Control API 镜像内会写入 OCI metadata：版本、Git revision、构建时间与源码地址。

如果某次只修改 Control API、不需要重新冻结浏览器镜像，可执行：

```powershell
.\scripts\build-production.ps1 -SkipBrowserBundle
```

单独重建 Browser Bundle：

```powershell
.\scripts\build-browser-bundle.ps1 -Tag 1.2.0
```

### 6.1 手动构建

```powershell
$REV = git rev-parse --short HEAD
$DATE = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')

docker build `
  -f apps/control-api/Dockerfile.production `
  -t jingcang/control-api:1.2.0 `
  --build-arg VERSION=1.2.0 `
  --build-arg VCS_REF=$REV `
  --build-arg BUILD_DATE=$DATE `
  .
```

## 7. 构建前质量门禁

正式发布前执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm test
pnpm audit --prod
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml config -q
```

任一命令失败都不应继续发布。

## 8. 启动生产环境

```powershell
docker compose `
  --env-file deploy/.env.production `
  -f deploy/compose.production.yaml `
  up -d
```

如果目标机器不负责构建镜像，需要同时准备 Control API 与 Browser Bundle：

```powershell
docker pull jingcang/control-api:1.2.0
docker pull jingcang/browser-bundle:1.2.0
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml up -d --no-build
```

生产 Compose 会先运行一次 `browser-preload`。它挂载 `/var/run/docker.sock`，把 bundle 内的浏览器镜像通过 `docker load` 导入宿主 Docker Engine；只有 preload 成功后 Selenium Dynamic Grid 才会启动。因此目标机即使无法访问公网，也可以直接使用 bundle 中的预置浏览器版本。

## 9. 健康检查

查看服务：

```powershell
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml ps
```

检查 HTTP：

```powershell
curl.exe http://127.0.0.1:8088/health/live
curl.exe http://127.0.0.1:8088/health/ready
```

`/health/ready` 必须同时显示：

```text
db: UP
grid: UP
```

同时执行项目验证：

```powershell
.\scripts\verify.ps1 -TargetUrl http://127.0.0.1:8088
```

## 10. 生产镜像结构

`Dockerfile.production` 使用三阶段构建：

1. `build`：安装完整依赖并编译 contracts、browser-catalog、React UI 和 Control API。
2. `prod-deps`：只安装 Control API 运行所需生产依赖。
3. `runtime`：只复制 `dist`、生产依赖、运行时 package metadata 和默认 browser catalog。

最终 Control API 镜像不包含 TypeScript 源码、测试源码、Vite 开发服务器或 TypeScript 编译器。Node 基础镜像、生产 Nginx 与 Selenium Dynamic Grid 使用固定 manifest digest。Chrome / Edge / Firefox 使用 `latest` 作为运行时名称，但 Browser Bundle 会在发布构建时将当时的三个 Latest 镜像内容冻结进离线包，因此离线部署不会在启动时自动漂移到新的远端 Latest。

生产镜像内复制的是 `browser-catalog.production.yaml`，不会带入开发 PoC 中的 `host.docker.internal:4447~4453` 等本机端口配置。

`browser-catalog.production.yaml` 与 `docker.production.toml` 同步包含 Browser Bundle 中的三个预置入口：Chrome Latest、Edge Latest、Firefox Latest。若以后调整离线预置范围，需要同步更新 `deploy/browser-bundle/images.txt`、生产 catalog 与 Dynamic Grid 配置。

## 11. 持久化与备份

生产 Compose 使用 named volumes：

```text
jingcang_prod_db
jingcang_prod_artifacts
jingcang_prod_logs
```

升级前必须备份数据库。当前 `scripts/backup.ps1` 面向默认开发 Compose；生产环境建议使用临时 helper container 导出 volume：

```powershell
docker run --rm `
  -v jingcang_prod_db:/source:ro `
  -v ${PWD}\backups:/backup `
  alpine sh -c "cp /source/jingcang.sqlite /backup/jingcang-prod.sqlite"
```

SQLite 使用 WAL 时，最稳妥的方式是在备份前短暂停止 Control API：

```powershell
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml stop control-api
# 执行数据库备份
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml start control-api
```

## 12. 升级流程

推荐流程：

```powershell
git fetch origin
git checkout main
git pull --ff-only

# 备份生产 DB
.\scripts\build-production.ps1 -Tag 1.1.1

docker compose `
  --env-file deploy/.env.production `
  -f deploy/compose.production.yaml `
  up -d --no-deps control-api

.\scripts\verify.ps1 -TargetUrl http://127.0.0.1:8088
```

更新 `JINGCANG_IMAGE_TAG` 后再执行 Compose，确保部署版本与镜像 tag 一致。

## 13. 回滚流程

保留至少一个上一个稳定版本镜像，例如：

```text
jingcang/control-api:1.1.0
jingcang/control-api:1.1.1
```

回滚时：

1. 停止 Control API。
2. 如数据库 schema/数据发生不兼容变化，恢复升级前备份。
3. 将 `JINGCANG_IMAGE_TAG` 改回上一个稳定版本。
4. 执行 Compose `up -d --no-build`。
5. 再次运行 `/health/ready` 和 `verify.ps1`。

## 14. 发布到镜像仓库

示例使用 GHCR：

```powershell
docker login ghcr.io
docker tag jingcang/control-api:1.2.0 ghcr.io/programmerguohuajing/jingcang:1.2.0
docker push ghcr.io/programmerguohuajing/jingcang:1.2.0
```

正式环境建议使用不可变版本号或 digest，不要仅依赖 `latest`。

## 15. 安全要求

- `deploy/.env.production` 权限应限制为部署管理员可读。
- Docker Socket 不得暴露到 TCP 公网。
- 当前“在线增加浏览器版本”和 Selenium Dynamic Grid 都需要访问 Docker Socket；获得 Docker Socket 访问权等价于获得宿主机高权限，应限制生产主机登录权限。
- 网关默认只监听 `127.0.0.1`。公网环境应由独立 TLS 反向代理暴露。
- 不要直接暴露 4444、5900、7900。
- 定期执行 `pnpm audit --prod` 并更新固定镜像版本。
- 生产数据卷应纳入离机备份策略。

## 16. 停止与删除

停止服务但保留数据：

```powershell
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml down
```

不要在生产环境随意使用 `down -v`，因为它会删除数据库与产物卷。

## 17. 常用排查

```powershell
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml ps
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml logs --tail=200 control-api
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml logs --tail=200 selenium-docker
docker image inspect jingcang/control-api:1.2.0
docker volume ls | findstr jingcang_prod
```

若 `control-api` 健康但 `ready` 为 DOWN，优先检查 Selenium Grid；若 DB 为 DOWN，检查 `jingcang_prod_db` volume 和 SQLite 文件权限。