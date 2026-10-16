# 局域网 HTTPS 证书（mkcert 本地 CA）

`compose.mobile-dev.lan.yaml` 需要这里放两个文件（git 不提交，只放本机）：

- `jingcang-lan.pem`（证书）
- `jingcang-lan-key.pem`（私钥）

## 生成（在跑 Docker 的机器上执行一次）

```bash
# Windows: choco install mkcert   /  Linux: apt install mkcert（或去 GitHub 下二进制）
mkcert -install
cd deploy
mkcert -cert-file certs/jingcang-lan.pem -key-file certs/jingcang-lan-key.pem \
  192.168.1.100 localhost 127.0.0.1
```

把 `192.168.1.100` 换成这台机器实际的局域网 IP（`ipconfig` / `ip addr` 查看）。
多网卡/ DHCP 经常变的话，可以把常用 IP 都列上，一次生成：

```bash
mkcert -cert-file certs/jingcang-lan.pem -key-file certs/jingcang-lan-key.pem \
  192.168.1.100 192.168.0.100 localhost 127.0.0.1
```

## 访问的电脑也要装 CA

mkcert 是本地自签 CA，**每台来访问的电脑**都要执行一次 `mkcert -install`
（把 CA 根证书装进系统信任库），否则浏览器会报 `NET::ERR_CERT_AUTHORITY_INVALID`。
装完重启浏览器，再打开 `https://<局域网IP>:28443`。
