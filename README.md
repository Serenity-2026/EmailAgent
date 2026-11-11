# EmailAgent

更新时间：2026-10-07
更新内容：补充从 GitHub 下载桌面安装包及从源码启动的步骤。

面向课程作业的 Electron 桌面邮件助手，支持 QQ/163 邮箱、每日 AI 摘要、一句话写邮件与带来源的 Agent 对话。中文桌面界面连接独立 Node.js 后端，用户数据与会话保存在 Docker MySQL 中。邮箱授权码和 AI Key 按用户加密；使用 AI 功能时，所选邮件片段发送给用户配置的模型服务。

## 使用桌面应用

1. 在 Apple Silicon Mac 上安装 Docker Desktop，或安装 Docker Engine/Compose 与 Colima。应用会自动启动已安装的 Docker 环境。
2. 从 [GitHub Releases](https://github.com/Serenity-2026/EmailAgent/releases/latest) 下载 `EmailAgent-mac-arm64-one-click-20261007.zip`，解压后双击 `EmailAgent.app`。
3. 等待应用自动启动 MySQL 和后端。首次启动需要联网获取 MySQL 和 Node 基础镜像；随后使用初始账号 `dmc`、密码 `123456` 登录。已有用户使用原密码，登录状态会自动恢复。

服务不可用时，应用内可点击“重新连接”。MySQL 数据保存在 Docker 命名卷中，关闭应用或重启电脑不会清空数据。

## 从源码启动

需要 Node.js 22 或更新版本、npm 和可用的 Docker Engine/Compose。克隆仓库后，在项目目录执行：

```bash
npm ci
cp .env.example .env
```

在 `.env` 填入 MySQL root 初始密码、独立的应用数据库密码和 `SESSION_KEY`。`SESSION_KEY` 可用 `openssl rand -base64 32` 生成；后续重启保留这个值，以恢复有效登录会话。`.env` 不提交到 Git。

```bash
npm run services:up
npm run dev
```

`services:up` 在源码开发时启动 MySQL 和后端，并等待健康检查。桌面安装包会自动完成该步骤。默认 API 为 `127.0.0.1:3210`，MySQL 为 `127.0.0.1:3306`，数据库名 `emailagent`。后端也可单独部署。

```bash
npm run services:down
```

停止服务保留 MySQL 命名卷；不要使用 `docker compose down -v`，它会删除数据库卷。

## 迁移旧数据

已有版本 2 的用户加密文件可迁入数据库：

```bash
npm run backend:migrate -- '/Users/你的账号/Library/Application Support/EmailAgent/emailagent.enc'
```

迁移保留原密码、邮箱与 AI 配置、主题和对话记录；源文件先备份并保留。相同文件重复导入不会重复创建用户；已有同名且不同的数据库用户会阻止迁移。旧 `safeStorage` 格式应先使用之前版本升级。迁移后在新桌面应用登录一次，之后可以自动恢复。

## 开发与验证

```bash
npm run typecheck
npm test
npm run test:backend
npm run build
npm run package:mac
```

`test:backend` 使用 `.env` 中的 root 凭据创建隔离测试数据库，结束后删除测试数据库，不使用正式用户数据。`npm run package:mac` 在 `release/mac-arm64/EmailAgent.app` 生成可双击的应用。

后端代码在 `src/backend`，Electron 系统代码在 `src/main`，React 界面在 `src/renderer`，共享 API 与数据契约在 `src/shared`。需要在宿主机调试后端时：

```bash
npm run backend:build
npm run backend:start
```

先停止 Compose 的后端容器，避免占用相同端口。桌面可通过启动环境变量 `EMAILAGENT_API_URL` 指定 HTTPS 或本机 API 地址。

## 邮箱和 AI 设置

点击左下角头像打开设置，添加 QQ 或 163 邮箱；先在服务商网页启用 IMAP/SMTP，再填完整邮箱地址和客户端授权码。保存前验证收信与发信连接。不要输入网页登录密码。

在 AI 设置填入兼容 Chat Completions 的 HTTPS `base_url` 和 API Key，加载模型列表后选择模型并保存。数据库按用户加密保存邮箱授权码和 AI 配置。退出登录会撤销后端会话；修改密码会撤销其他会话。

## 功能范围

- 邮件列表最近 50 封；每日摘要每账户最多读取最近 30 封当日邮件。
- “对话”默认检索全部邮箱近 90 天的收件箱与已发送，回答附可点击的原邮件来源。
- 对话区顶部展示近 30 天收发数量、往来人和内容星图；主题分析最多读取最近 20 封邮件片段。
- Agent 可提议标记已读、标记未读和归档，确认后执行并逐项报告；归档需要服务商已有归档文件夹。
- 对话记录按用户加密保留最近 30 天，不持久保存邮件全文或模型收到的正文片段。
- 邮件 HTML 经净化与沙箱显示；远程图片按封手动加载；附件只显示名称。
- 所有发信先编辑、预览，再由用户点击“确认发送”。
- 亮色、暗色和系统主题偏好存于当前用户数据中。

产品规格见 [SPEC.md](SPEC.md)，数据表、API 与业务边界见 [doc/architecture.md](doc/architecture.md)。

## 版本更新记录

### 0.1.1 - Q0 可复现质量门禁（2026-11-11）

- 新增 GitHub Actions 验证流程，固定执行依赖安装、类型检查、单元测试、MySQL 隔离集成测试和生产构建。
- `npm run test:backend` 改用 Node 启动脚本，可在 Windows、macOS 和 Linux 使用；存在 `.env` 时自动加载，本机无 `.env` 时可直接使用 CI 环境变量。
- 新增 RPC 参数边界测试，以及登录、邮箱列表、写信预览和 Agent 整理确认的 Renderer 冒烟测试。
- 普通验证需要 Node.js 22 及 npm，执行 `npm ci && npm run typecheck && npm test && npm run build`。
- 数据库集成测试额外需要可连接的 MySQL 8.4 和 `MYSQL_ROOT_PASSWORD`；测试只创建并删除随机命名的隔离数据库。
- `npm run package:mac` 仍需在 macOS 上执行，并需要 Electron 运行时及项目依赖已完成安装。

### 0.1.2 - R1 Renderer 领域模块化（2026-11-11）

- React 启动入口缩减为只挂载应用根组件，主题适配与应用壳层移入 `src/renderer/src/app/`。
- 登录与恢复、邮件阅读与写信、每日摘要、Agent 对话、账户和 AI 设置分别移入 `src/renderer/src/features/` 下的独立领域模块。
- 会话、账户设置、邮件、摘要和 Agent 状态由领域 hook 管理，继续保留会话 epoch 防止登出后的异步结果串入新会话。
- 原单一样式文件拆分为基础壳层、邮件、Agent、弹窗和暗色主题文件；界面类名和视觉行为保持不变。
- Renderer 冒烟测试继续覆盖登录、邮件列表、写信预览和 Agent 整理确认，拆分未改变桌面 API 契约。

### 0.1.3 - M1 邮件引用与读取管线（2026-11-11）

- 普通邮件详情现在携带邮箱文件夹 UIDVALIDITY；回复发送前同时核对文件夹、UID 和 UIDVALIDITY，文件夹重建后拒绝沿用旧引用。
- 每日摘要对每个邮箱只建立一次只读 IMAP 连接，在同一锁内读取最多 30 封邮件，不会因为摘要而标记已读。
- 普通阅读在下载正文前检查原始 MIME 大小，上限为 20 MB；AI 摘要和 Agent 正文读取上限为 5 MB。
- 摘要批量读取中单封邮件超限、移动或解析失败时跳过该封，并在摘要页展示警告，其余邮件仍可用于生成摘要。
- 新增 UIDVALIDITY、超大 MIME、单连接批量读取、部分失败和不标已读回归测试。
