# Docker 部署与公网入口

当前在线体验是 **[https://story-explorer.nas.haiqingd.top:1443/](https://story-explorer.nas.haiqingd.top:1443/)**。请保留端口；该服务公网 443 不可访问。

## 独立部署

从 [README](../README.md#快速开始docker) 的 `compose.standalone.yaml` 开始。它将容器的 8080 映射到本机 `127.0.0.1:8765`，不依赖 Nginx、域名或证书。

```bash
mkdir -p data
LOOPER_UID=$(id -u) LOOPER_GID=$(id -g) \
  docker compose -f compose.standalone.yaml up -d --build --wait
```

`LOOPER_UID`、`LOOPER_GID` 默认均为 1000。Linux 上建议使用创建 `data/` 的用户 ID；已有数据目录需保证容器用户可写。更换端口时设置 `LOOPER_PORT`，后续更新和查看配置时使用相同变量。

镜像包含 Python、FFmpeg、Tesseract 简繁中文语言包及 Pillow。Dockerfile 使用国内镜像源；其他网络环境可自行替换基础镜像、Debian 与 PyPI 镜像地址。

## 通过已有 Nginx 网关发布

仓库根目录的 `compose.yaml` 对接当前服务使用的共享网关。它要求 Docker 网络 `host-nginx_default` 已存在，应用容器名为 `story-explorer`，不直接发布应用端口。

1. 将域名指向网关服务器，配置对应的 HTTPS 证书。
2. 让网关容器加入 `host-nginx_default`，并将宿主机 **1443** 映射到 Nginx 容器 **8443**。同时开放服务器防火墙及需要的路由器端口转发。
3. 将 [deploy/story-explorer.conf](../deploy/story-explorer.conf) 加入网关配置；按自己的域名调整 `server_name` 和证书位置。模板中的证书路径是容器内路径，需要挂载实际证书。
4. 将 `compose.yaml` 的 `LOOPER_PUBLIC_ORIGINS` 调整为实际访问来源，例如 `https://example.com:1443`。填写协议、域名和端口，不包含路径；多个来源用逗号分隔。
5. 创建可写的 `data/` 目录，然后启动应用并检查网关配置。

```bash
mkdir -p data
# 此配置中应用使用 UID / GID 1000；数据目录需对该用户可写。
docker compose up -d --build --wait

# host-nginx 是当前部署的网关容器名；自部署时替换为自己的名称。
docker exec host-nginx nginx -t
docker exec host-nginx nginx -s reload
```

请求路径为：浏览器 `https://域名:1443` → 网关容器 `8443` → 应用容器 `8080`。**8443 是网关内部监听端口，公网体验链接使用 1443。** HTTP 跳转模板也保留 1443。

不要同时启动两套 Compose 配置并让它们写入同一个 `data/`。选择适合自己的部署方式。

若使用宿主机 Nginx，可以反向代理到独立部署的 `127.0.0.1:8765`；把独立 Compose 的 `LOOPER_PUBLIC_ORIGINS` 加入公网 HTTPS 来源，并让 Nginx 对外监听 1443。应用校验浏览器写入请求的 Origin，因此网关应保留请求中的 Host（包含端口），并正确设置 `X-Forwarded-Proto`。

## 更新与备份

应用数据在 `data/guides.sqlite3`，片尾证据在 `data/ending-evidence/`，不随源码提供。更新源码后执行所选配置的 `docker compose up -d --build --wait`；不要删除 `data/`。

备份运行中的数据库使用 SQLite backup API。需要直接复制整个目录时，先停应用，复制完再启动；以下以独立部署为例：

```bash
docker compose -f compose.standalone.yaml stop app
tar -czf ../story-explorer-data-backup.tar.gz data
docker compose -f compose.standalone.yaml start app
```

备份包含数据库和证据；JSON 导出适合迁移攻略与标注，但不包含证据图片。恢复备份后检查目录归属是否与容器用户匹配。

## 配置与核心功能运行

| 配置 | 用途 |
| --- | --- |
| `LOOPER_DB` | SQLite 路径；Docker 镜像中为 `/app/data/guides.sqlite3` |
| `LOOPER_PUBLIC_ORIGINS` | 允许浏览器写入的额外来源，逗号分隔 |
| `LOOPER_PORT` | 独立 Compose 的宿主机端口，默认 8765 |
| `LOOPER_UID` / `LOOPER_GID` | 独立 Compose 的容器用户，默认 1000 |
| `--host` / `--port` | Python 服务的监听地址与端口 |

不使用 Docker 时，Python 3.11+ 可运行核心功能：`python3 server.py`，默认监听 `127.0.0.1:8765`。片尾识别另需安装 FFmpeg、Tesseract、中文语言包及 Pillow；缺少组件不影响核心剧情采集与路线分析。

Bilibili Cookie 通过页面的「登录设置」按次提交，不写入 Compose、数据库或仓库。页面的攻略库由服务端共享，当前应用没有独立用户账户；公网部署应按需要在网关设置访问范围。
