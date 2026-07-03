# 跑起来看（3 步，约 5 分钟）

这是一套交易所演示系统（后端 + 管理台 + 客户端 + 账本），用 Docker 一键启动，**不用装 Node、数据库或任何环境**。

## 第 1 步 · 装 Docker Desktop（只需一次）

下载：https://www.docker.com/products/docker-desktop/

- **Windows**：安装时按提示开启 WSL2（可能需要管理员权限）。
- **Mac**：选对应芯片版本（Apple 芯片 / Intel）。

装好后**打开 Docker Desktop，等左下角图标变绿**（引擎就绪）。

## 第 2 步 · 在本文件夹打开终端，运行

```
docker compose up --build
```

首次会自动构建 + 拉依赖，约几分钟（需联网）。
看到日志刷出 `demo:all DONE ✅` 就代表数据铺好、可以用了。

## 第 3 步 · 浏览器打开

| 界面 | 地址 |
|---|---|
| 管理台（Admin） | http://localhost:18081 |
| 客户端（Client） | http://localhost:18082 |

登录账号：**admin@fiatx.com** ／ 密码：**123456**

充值、兑换、提现、对账的演示数据已经自动预置好，直接点开看。

---

## 常用操作

- **停止**：终端里按 `Ctrl + C`，或另开终端 `docker compose down`
- **重来一遍全新的**：`docker compose down -v && docker compose up --build`
- **端口被占了想换**：在本文件夹新建一个 `.env` 文件，写入（示例改成空闲端口）：
  ```
  DEMO_API_PORT=28080
  DEMO_ADMIN_PORT=28081
  DEMO_CLIENT_PORT=28082
  ```
  再重新 `docker compose up`，管理台就变成 http://localhost:28081。

## 遇到问题

- **账本端报 `io_uring` / `PermissionDenied`**：多为过新的 Docker Desktop for Mac 限制，可改用免费的 OrbStack。
- **端口 `address already in use`**：按上面「换端口」处理。
- 其它报错：把 `docker compose logs backend` 最后几十行发回即可。
