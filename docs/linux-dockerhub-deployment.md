# 镜舱（JingCang）Docker Hub + Docker Compose 部署

> 服务器只需要 Docker Engine 和 Docker Compose v2。
> 不需要源码、不需要 Git、不需要 Node.js / pnpm，也不需要在服务器构建镜像。

项目已经提供可直接部署的 Compose 文件：

```text
deploy/dockerhub/compose.yaml
```

该文件已经包含：

- 镜舱 Control API / Web 镜像
- Browser Bundle 镜像
- Nginx Gateway
- Selenium Dynamic Grid
- Nginx 配置（已内嵌在 Compose 启动命令中）
- Selenium Dynamic Grid 配置（已内嵌在 Compose 启动命令中）
- 数据持久化卷
- 健康检查

## 1. 服务器要求

建议至少 4 vCPU、8 GB RAM、30 GB 可用磁盘，Linux amd64/x86_64。

确认 Docker：

```bash
docker version
docker compose version
```

使用 Docker Compose v2 即可；部署文件不依赖 Swarm Config，也不需要额外的 Nginx 或 Selenium 配置文件。

## 2. 准备部署目录

将项目提供的 `deploy/dockerhub/compose.yaml` 单独复制到 Linux 服务器，例如：

```text
/opt/jingcang/compose.yaml
```

服务器目录最终只需要：

```text
/opt/jingcang/
└── compose.yaml
```

不需要复制其他项目源码或配置文件。

## 3. 生成部署环境变量

进入目录：

```bash
cd /opt/jingcang
```

执行下面这组命令生成 `.env`：

```bash
SERVER_IP=$(hostname -I | awk '{print $1}')
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')

cat > .env <<EOF
JINGCANG_VERSION=1.1.0
JINGCANG_BIND_HOST=0.0.0.0
JINGCANG_PORT=8088
JINGCANG_LAN_ACCESS_ENABLED=true
JINGCANG_BASE_URL=http://${SERVER_IP}:8088
JINGCANG_PUBLIC_HOSTNAME=${SERVER_IP}
JINGCANG_TIMEZONE=Asia/Shanghai
JINGCANG_SESSION_SECRET=$(openssl rand -hex 32)
JINGCANG_VIEWER_SECRET=$(openssl rand -hex 32)
JINGCANG_ADMIN_INITIAL_PASSWORD=${ADMIN_PASSWORD}
EOF

chmod 600 .env
echo "JingCang admin password: ${ADMIN_PASSWORD}"
```

请保存终端输出的管理员密码。

部署默认开启局域网访问：Gateway 绑定 `0.0.0.0:8088`，Control API 的 `JINGCANG_LAN_ACCESS_ENABLED=true`。因此同一局域网内其他设备可直接通过 `http://服务器IP:8088` 访问；如服务器启用了系统防火墙，还需要放行 TCP 8088。

初始管理员用户名固定为：

```text
admin
```

## 4. 校验 Compose

```bash
cd /opt/jingcang
docker compose config -q
```

没有报错即可继续。

## 5. 从 Docker Hub 拉取镜像

直接执行：

```bash
docker compose pull
```

Compose 会自动拉取：

```text
jingguohua102/jingcang:1.1.0
jingguohua102/jingcang:browser-bundle-1.1.0
Nginx
Selenium Dynamic Grid
```

如果 Docker Hub 仓库以后改为私有仓库，在 `pull` 前执行：

```bash
docker login
```

## 6. 启动

```bash
docker compose up -d
```

首次启动时 `browser-preload` 会自动把 Browser Bundle 中预置的浏览器镜像加载到宿主 Docker Engine：

- Chrome Latest
- Edge Latest
- Firefox Latest

首次导入浏览器镜像时可能需要一些时间。

## 7. 查看状态

```bash
docker compose ps -a
```

正常情况下：

```text
gateway           Up
control-api       Up (healthy)
selenium-docker   Up (healthy)
browser-preload   Exited (0)
```

`browser-preload` 显示 `Exited (0)` 是正常的，表示浏览器镜像已经导入完成。

如需查看日志：

```bash
docker compose logs -f --tail=200
```

## 8. 健康检查

```bash
curl -fsS http://127.0.0.1:8088/health/live
curl -fsS http://127.0.0.1:8088/health/ready
```

`/health/ready` 中数据库和 Selenium Grid 应处于正常状态。

## 9. 访问镜舱

查看服务器 IP：

```bash
hostname -I
```

浏览器访问：

```text
http://服务器IP:8088
```

例如：

```text
http://192.168.1.100:8088
```

登录：

```text
用户名：admin
密码：部署时生成并输出的 JINGCANG_ADMIN_INITIAL_PASSWORD
```

如果服务器开启了 UFW：

```bash
sudo ufw allow 8088/tcp
```

不要对外暴露 Docker API、Selenium 4444、VNC 5900/7900。

## 10. 停止、启动和日志

```bash
# 停止，保留数据
docker compose down

# 再次启动
docker compose up -d

# 查看状态
docker compose ps -a

# 查看日志
docker compose logs -f --tail=200
```

生产环境不要执行：

```bash
docker compose down -v
```

因为 `-v` 会删除生产数据卷。

## 11. 数据持久化

Compose 自动创建：

```text
jingcang_prod_db
jingcang_prod_artifacts
jingcang_prod_logs
```

检查：

```bash
docker volume ls | grep jingcang
```

## 12. 升级

例如升级到 `1.1.1`：

```bash
cd /opt/jingcang
sed -i 's/^JINGCANG_VERSION=.*/JINGCANG_VERSION=1.1.1/' .env
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:8088/health/ready
```

## 13. 回滚

例如回滚到 `1.1.0`：

```bash
cd /opt/jingcang
sed -i 's/^JINGCANG_VERSION=.*/JINGCANG_VERSION=1.1.0/' .env
docker compose up -d
curl -fsS http://127.0.0.1:8088/health/ready
```

## 14. 最终部署流程

实际部署只需要：

```bash
cd /opt/jingcang
# 放入项目提供的 compose.yaml
# 生成 .env
docker compose config -q
docker compose pull
docker compose up -d
docker compose ps -a
curl -fsS http://127.0.0.1:8088/health/ready
```

也就是说，Linux 服务器端真正需要维护的只有：

```text
compose.yaml
.env
```

其中 `compose.yaml` 由项目直接提供，`.env` 只保存版本、服务器地址和生产 Secret。
