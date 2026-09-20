# 镜舱（JingCang）日常运维与备份恢复手册

## 1. 健康检查

- `GET /health/live`：Control API 进程存活。
- `GET /health/ready`：SQLite 与 Selenium Grid 都必须正常；任一失败返回 HTTP 503。

运行：

```powershell
.\scripts\verify.ps1
```

## 2. 自动维护

Worker 默认每 30 秒运行一次：

- 仅回收真正达到 `expires_at` 的到期会话，并标记为 `EXPIRED`；
- 回收超过 `JINGCANG_SESSION_IDLE_MINUTES` 的空闲会话，并标记为 `TERMINATED / IDLE_TIMEOUT`；
- 服务重启后先重置未到期 READY 会话的空闲计时基线，再继续处理排队会话；
- 按 `JINGCANG_ARTIFACT_RETENTION_DAYS` 清理旧产物；
- 当产物总量超过 `JINGCANG_ARTIFACT_MAX_TOTAL_GB` 时，从最旧产物开始清理。

管理员控制台的“手动执行会话与产物清理”会立即运行同一维护流程。

## 3. 数据库与配置备份

```powershell
.\scripts\backup.ps1
```

备份包包含 SQLite 数据库和 `browser-catalog.yaml`。`.env` 与其他 Secret 不写入备份包，应单独按敏感凭据保管。Docker Compose 模式下数据库来源为 `jingcang_db` named volume。

## 4. 恢复

```powershell
.\scripts\restore.ps1 -ZipPath ".\backups\jingcang-backup-yyyyMMdd-HHmmss.zip"
```

恢复后重启服务，并依次检查 `/health/live` 与 `/health/ready`。

## 5. 浏览器目录更新

管理员可在“浏览器舱位矩阵”页面点击“增加浏览器版本”，选择 Chrome、Edge、Firefox 或 Chromium 并输入官方 Selenium 镜像标签。系统会异步完成以下流程：

1. 校验厂商和版本标签，只映射到 `selenium/standalone-*` 官方仓库；
2. 通过 Docker Engine 下载镜像（本地已有镜像时直接复用）；
3. 在 `jingcang_backend` 网络启动独立浏览器节点；
4. 等待 `/status` 健康检查通过；
5. 将节点地址写入浏览器舱位目录并启用。

安装过程中页面会显示“任务校验、下载镜像、启动节点、接入矩阵”四个阶段。若 Control API 在安装中重启，未完成任务会标记失败，已启动但未注册的容器会在恢复流程中清理，可由管理员重新提交。

版本值对应 Docker 镜像标签，例如 `130.0` 或 `4.35.0-20250909`。若 Docker Hub 中不存在该标签，任务会失败且不会写入舱位目录。

静态内置版本仍可通过文件维护。修改 `deploy/selenium/browser-catalog.yaml` 后运行：

```powershell
.\scripts\update-browser-catalog.ps1
```

浏览器目录会在 Control API 启动时进行 Zod 校验。无效 YAML 或非法字段会导致同步失败，而不是静默进入数据库。页面动态添加的版本以 `dynamic` 来源保存在 SQLite 中，不会因下一次静态 YAML 同步而被禁用。

## 6. 故障排查顺序

1. `docker compose -f deploy/compose.yaml ps`
2. `GET /health/live`
3. `GET /health/ready`
4. 运行 `docker exec jingcang-selenium-docker-1 curl -fsS http://127.0.0.1:4444/status` 检查容器内 Grid
5. 检查 Control API 日志与管理页审计事件
6. 最后检查 Dynamic Grid 创建的浏览器容器状态
