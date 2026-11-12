# EmailAgent 平台打包与运行前置条件

更新时间：2026-11-12

## 共同要求

- 使用 Node.js 22 和锁文件安装依赖：`npm ci`。
- 本地服务要求 Docker Engine 可用，并提供 Compose v2 的 `docker compose` 命令；容器运行 Linux 镜像。
- 打包后的首次业务启动仍需 Docker 拉取 MySQL 8.4 与 Node 22 基础镜像。`verify:package:*` 只验证主进程、preload 和 Renderer 能从打包目录成功加载，不会连接真实邮箱、数据库或用户 Docker 服务。
- 会话令牌只有在 Electron `safeStorage` 报告加密可用时才保存；安全存储不可用不会影响手动登录和服务端加密数据。

## macOS

打包与启动验证必须在 macOS 主机执行：

```bash
npm run package:mac
npm run verify:package:mac
```

应用目录位于 `release/mac*`。运行本地服务前需满足以下条件：

- 安装并启动 Docker Desktop，或安装 Colima、Docker CLI 与 Compose v2。应用会先检查 Docker，引擎未运行时会尝试启动 Colima，否则尝试打开 Docker Desktop。
- 当前登录用户可使用 macOS 钥匙串。Electron 使用钥匙串保护会话令牌；钥匙串锁定、权限被拒绝或加密不可用时，下次启动需要重新登录。
- 未签名的本地开发包可能需要在“隐私与安全性”中由用户明确允许。正式分发仍应配置开发者签名与公证，本仓库的目录型验证不代替签名发布流程。

## Windows

Windows 交付目标为 x64 目录包，打包与启动验证必须在 Windows x64 主机执行：

```powershell
npm run package:win
npm run verify:package:win
```

可执行文件位于 `release\win-unpacked\EmailAgent.exe`。运行本地服务前需满足以下条件：

- Windows 10/11 x64 已启用硬件虚拟化和 WSL 2，Docker Desktop 使用 Linux 容器，并能在当前用户终端执行 `docker info` 与 `docker compose version`。
- Docker Desktop 安装在当前 PATH 或标准的 `Program Files`/当前用户目录。引擎未运行时，应用会在标准位置隐藏启动 Docker Desktop，再等待引擎就绪。
- Electron 使用当前 Windows 用户的 DPAPI 保护会话令牌。不同 Windows 用户、用户配置文件被重建或系统凭据不可用时，旧令牌不能解密，应用会删除该令牌并要求重新登录，不影响 MySQL 中的加密用户数据。
- 目录包用于自动化与开发验收；面向最终用户分发时应另外生成并签名安装包。

## Linux 边界

Linux 当前只支持源码开发和后端部署，不在本轮桌面交付矩阵中。使用桌面开发模式时需自行提供 Docker Engine、Compose v2 与 Secret Service（例如已解锁的 GNOME Keyring/KWallet）。若 Electron 只能使用 `basic_text` 安全存储后端，EmailAgent 不保存会话令牌，每次重启后需重新登录。

## 启动验证口径

`verify:package:mac` 与 `verify:package:win` 使用隔离的临时用户目录和不可达的本机测试 API 地址启动打包程序。主进程创建隐藏窗口，只有主页面与 preload 成功加载后才原子写入就绪标记并以状态码 0 退出；超时、进程异常、非打包运行、页面加载失败或标记不一致都会使命令失败。验证结束会移除临时用户目录，不读取或修改真实用户会话。

GitHub Actions 在 macOS 与 Windows runner 上分别执行对应的目录打包和启动验证。实际 Docker 主链路仍需在目标平台确认 `docker info`、`docker compose version`，再启动应用完成首次管理员创建和重新连接检查。
