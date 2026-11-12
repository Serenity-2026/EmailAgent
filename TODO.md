# EmailAgent TODO

更新时间：2026-11-11

更新内容：基于 `EmailAgent/` 当前代码、规格、测试和部署配置完成首轮体检；按可独立提交、可分配协作者、低冲突合并的方式整理优化模块。

## 当前结论

项目的首版主链路已经完整：本地用户与会话、QQ/163 多账户、IMAP/SMTP 收发、HTML 安全展示、AI 摘要、AI 草稿、受限 Agent、操作确认、主题、MySQL 持久化和一键启动均已有实现。下一阶段不宜先堆更多页面，建议优先处理安全初始化、前端解耦、邮件读取正确性、长任务并发和自动摘要可靠性。

本轮检查发现的主要依据：

- `src/renderer/src/main.tsx` 为 951 行单组件，集中维护登录、账户、邮件、摘要、Agent、设置和全部弹窗状态；不同功能的协作者仍会频繁修改同一文件。
- `todayMail()` 先查询摘要，再为最多 30 封邮件逐封调用 `getMail()`；当前实现每封都会重新建立 IMAP 连接，单账户一次摘要最多可产生约 31 次连接。
- 普通“回复”只保存 `uid + folder`，未携带 `UIDVALIDITY`；邮箱文件夹重建后存在用旧 UID 关联到错误原邮件的风险。Agent 草稿已经携带该字段，可复用同一规则。
- `BackendContext.invoke()` 使用单一 Promise 队列串行化该会话的全部 RPC；一次较慢的 Agent、摘要或概览可能阻塞同一会话的邮件读取等无关操作。
- 定时摘要在开始生成前就把当天记为已尝试；本次失败后当天不会自动重试。摘要时间还取决于后端容器时区，而不是显式保存的用户/桌面时区。
- 数据库初始化会固定创建 `dmc / 123456`。这适合课程演示，但不适合作为普通安装的默认安全策略；登录接口也没有失败频率限制。
- 现有测试重点覆盖 AI/Agent 边界、IMAP 操作、数据库和邮件 HTML 安全，但缺少主要 React 流程、RPC 参数契约、定时任务和长任务并发测试。
- 当前没有 CI 工作流；`test:backend` 使用 POSIX 环境变量写法，在 Windows 默认 npm shell 下不可直接运行。
- 首次检查时未安装 `node_modules`，当时 `npm run typecheck` 和 `npm test` 均停在“命令不存在”，不是代码测试失败。Q0 已执行 `npm ci` 并建立真实基线。

## 协作与提交规则

- 每个编号模块使用一个主题分支和一个 PR；不要把“顺手重构”、依赖升级或其他模块混入同一 PR。
- 分支从最新 `main` 创建，建议使用下文给出的中性名称。项目规则禁止直接在 `main` 开发。
- 每个提交只完成一个可验证的小目标。提交正文需按 `EmailAgent/AGENTS.md` 原样保留本次用户需求，不添加 AI 署名。
- 行为、API、表结构或状态流转发生变化时，同一提交同步更新 `SPEC.md` 或 `doc/architecture.md` 中已有的对应说明。
- 公共契约优先落在 `src/shared`；功能代码放到自己的领域目录，避免再次形成共享“大文件”。
- 每个 PR 至少通过 `npm run typecheck`、`npm test` 和 `npm run build`；涉及数据库时再通过 `npm run test:backend`，涉及打包时再执行目标平台打包验证。
- PR 描述必须写明：变更边界、未处理内容、手工验证路径、数据/API 兼容性和回滚方式。

## 推荐实施顺序

第一批可并行：`Q0`、`R1`、`M1` 的纯后端部分。三者主要分别修改工程配置、前端目录和邮件后端，冲突较少。

第二批在 `R1` 合并后并行：`S1`、`A1`、`D1`、`B1`。这些模块分别由认证、Agent、摘要、邮箱导航协作者负责，并修改拆分后的独立页面。

第三批按产品优先级选择：`C1`、`O1`。它们不阻塞前两批。

---

## Q0：建立可复现的质量门禁

优先级：P0

建议分支：`chore/quality-gate`

状态：已完成（2026-11-11）

目标：让 Windows、本地开发和 CI 使用同一组命令得到可信结果，先建立后续重构的安全网。

任务：

- [x] 已完成：执行 `npm ci`，记录 `typecheck`、单元测试和构建的真实基线；只修复阻塞后续任务的既有问题。
- [x] 已完成：用 Node 包装脚本设置 `EMAILAGENT_MYSQL_TEST=1`，替换 `test:backend` 中仅适用于 POSIX shell 的写法。
- [x] 已完成：增加 CI，安装锁定依赖、执行类型检查、单元测试、构建，并使用隔离 MySQL 8.4 服务执行数据库集成测试。
- [x] 已完成：为 `validateRpc()` 增加参数边界测试；现有集成测试的延迟 Agent mock 与 Vitest 可控时钟作为后续并发/定时测试基础。
- [x] 已完成：增加最小 React 冒烟测试，覆盖登录态、邮箱列表、写信预览和 Agent 确认按钮的关键可达性。
- [x] 已完成：在 README 追加 Q0 版本记录，写清普通测试、MySQL 集成测试和平台打包所需环境。

建议提交拆分：

1. `chore: make backend tests cross-platform`
2. `test: cover RPC and renderer smoke paths`
3. `ci: verify typecheck tests build and MySQL integration`

验收条件：

- [x] 已完成：全新检出可按 README 先执行 `npm ci`，再运行统一验证命令。
- [x] 已完成：CI 工作流会阻止类型错误、单元测试失败、构建失败和数据库集成回归。
- [x] 已完成：数据库集成测试创建随机隔离数据库并在结束后删除，不读取或清理正式数据库卷。

## R1：拆分 Renderer 领域模块

优先级：P0

建议分支：`refactor/renderer-modules`

状态：已完成（2026-11-11）

目标：不改变现有行为，把 951 行单组件拆成可由不同协作者独立维护的领域模块。

任务：

- [x] 已完成：`main.tsx` 仅保留 7 行 React 启动逻辑；应用壳层负责会话、主题和顶层视图组合。
- [x] 已完成：按领域拆出 `auth`、`accounts/settings`、`mail/compose`、`digest`、`agent` 组件与会话、账户设置、邮件、摘要、Agent 状态 hook。
- [x] 已完成：统一保留异步错误展示、会话 epoch 防串号和各领域弹窗状态重置逻辑，现有中文提示语不变。
- [x] 已完成：`styles.css` 改为入口，样式按基础壳层、邮件、Agent、弹窗和暗色主题拆分。
- [x] 已完成：Q0 Renderer 冒烟测试改为从新应用壳导入，继续覆盖登录、邮件列表、写信预览和 Agent 确认流程；未改变产品 API。
- [x] 已完成：本模块只移动既有 antd 组件及属性，没有新增未经核对的 antd API。

建议目录边界：

- `src/renderer/src/app/`：会话、主题、顶层布局。
- `src/renderer/src/features/mail/`：列表、详情、HTML 正文、写信与回复。
- `src/renderer/src/features/agent/`：概览、对话、来源与操作提案。
- `src/renderer/src/features/digest/`：摘要与来源。
- `src/renderer/src/features/settings/`：用户、邮箱和 AI 设置。
- `src/renderer/src/shared/`：仅放真正跨领域的 UI/错误工具。

建议提交拆分：

1. `refactor: extract app shell and session state`
2. `refactor: split mail digest and agent views`
3. `refactor: split settings dialogs and styles`
4. `test: preserve renderer workflows after split`

验收条件：

- [x] 已完成：全量类型检查、单元测试、Renderer 关键路径测试和生产构建证明原有主流程保持可用。
- [x] 已完成：邮件、摘要、Agent、认证和设置视图已有独立文件，功能协作者不再必须修改同一个页面文件。
- [x] 已完成：未引入新的全局状态库，使用领域 hook 和明确 props 组合。

## M1：修复邮件引用正确性并降低 IMAP 连接压力

优先级：P0

建议分支：`fix/mail-read-pipeline`

状态：已完成（2026-11-11）

目标：确保回复引用不会因文件夹重建而串信，并显著减少摘要读取的重复连接。

任务：

- [x] 已完成：普通邮件详情返回当前文件夹 `UIDVALIDITY`，回复草稿携带该值，发送前由后端重新核对。
- [x] 已完成：抽出“在已打开邮箱连接和锁内解析邮件”的内部函数，`todayMail()` 不再对每封邮件重新连接。
- [x] 已完成：当日摘要在单账户的一次只读连接中批量读取最多 30 封正文，保留不标记已读和每封正文最多向 AI 提供 1500 字符的边界。
- [x] 已完成：普通阅读先检查 MIME 大小，20 MB 以上拒绝读取；AI 读取上限为 5 MB，阈值已写入架构文档。
- [x] 已完成：补充 UIDVALIDITY 变化、批量读取部分失败、超大邮件和摘要不标已读的回归测试。

建议提交拆分：

1. `fix: bind normal replies to mailbox UIDVALIDITY`
2. `perf: batch daily digest mail reads per account`
3. `test: cover stale replies and bounded MIME reads`

验收条件：

- [x] 已完成：文件夹 UIDVALIDITY 改变后，旧详情不能被用于生成带错误线程关系的回复。
- [x] 已完成：单账户 30 封摘要复用一次 IMAP 连接，不再建立约 31 次连接。
- [x] 已完成：单封失败以摘要警告报告，成功读取的邮件不会被标为已读。

## S1：移除普通安装的固定默认密码

优先级：P0

建议分支：`fix/secure-bootstrap`

依赖：建议在 `R1` 后合并，认证页面修改会更独立。

状态：已完成（2026-11-11）

目标：保留课程演示便利性，但普通安装不能天然暴露公开的 `dmc / 123456` 凭据。

任务：

- [x] 已完成：演示用户初始化改为显式 `EMAILAGENT_DEMO_MODE=1`；普通安装使用只能执行一次的首次管理员创建流程。
- [x] 已完成：已有用户的数据库升级时自动把初始化状态标为完成，不覆盖已有 `dmc`、其他用户、密码、会话或加密数据。
- [x] 已完成：连续登录失败按来源和账号短时限流，未知账号与错误密码返回统一错误，代码和日志不记录密码。
- [x] 已完成：架构文档明确本机回环绑定与远程 TLS 反向代理边界，桌面继续拒绝非本机明文 HTTP 后端。
- [x] 已完成：增加首次启动、旧数据库升级、限流恢复、会话重启保持和演示模式界面测试。

建议提交拆分：

1. `feat: add secure first-run account bootstrap`
2. `fix: rate-limit repeated login failures`
3. `docs: separate demo and normal-install authentication`

验收条件：

- [x] 已完成：普通新安装没有预置用户，无法使用仓库公开的固定密码登录。
- [x] 已完成：显式演示模式仍可快速启动，登录界面清楚标注只用于演示且勿保存真实凭据。
- [x] 已完成：升级测试证明不会重置已有数据库中的 `dmc` 或其他用户。

## A1：让长任务可取消且不阻塞普通操作

优先级：P1

建议分支：`feature/cancellable-agent-jobs`

依赖：`Q0`、`R1`

状态：已完成（2026-11-11）

目标：Agent、概览和摘要运行时，用户仍能读邮件、切换页面或取消任务。

任务：

- [x] 已完成：会话执行模型改为短状态写入串行、只读和长任务并发；Agent 的最终历史写入重新进入状态队列并保留 vault revision 校验。
- [x] 已完成：每个 Agent 任务使用桌面生成的 job id 和后端 `AbortController`；新增 `agent:cancel`，信号贯穿三次模型请求与各阶段 `ensureActive()`。
- [x] 已完成：同一会话已有 Agent 任务时，第二个请求立即返回“请先取消或等待完成”，不进入状态写入队列。
- [x] 已完成：登出、会话失效、服务关闭和清空历史都会中止关联任务，取消路径不保存消息、历史或整理提案。
- [x] 已完成：Agent 页面在运行时显示“取消任务”，完成、失败和取消后保留最终状态；重复取消和已结束任务返回幂等状态。
- [x] 已完成：增加 Agent 运行时并发读取列表/详情、规划/检索/回答阶段取消、重复请求、清空历史和登出取消测试。

建议提交拆分：

1. `refactor: separate session state writes from long jobs`
2. `feat: add cancellable Agent jobs`
3. `test: cover concurrent mail access and Agent cancellation`

验收条件：

- [x] 已完成：并发测试证明 Agent 模型调用期间 `mail:list` 和 `mail:get` 可立即返回。
- [x] 已完成：三个执行阶段的取消测试证明不会新增助手消息、历史或待确认操作。
- [x] 已完成：登出测试证明任务收到中止信号，之后不再发事件或写入用户数据。

## D1：可靠的每日摘要、时区和历史

优先级：P1

建议分支：`feature/reliable-daily-digest`

依赖：`Q0`、`R1`；可与 `A1` 并行，但合并时统一长任务接口。

状态：已完成（2026-11-12）

目标：自动摘要失败可恢复，重启后仍能看到最近结果，并按用户实际时区触发。

任务：

- [x] 已完成：桌面在 RPC 与事件连接中上报 IANA 时区；后端验证后按该时区计算本地日期、午夜和执行时间，不依赖容器时区。
- [x] 已完成：自动摘要只有成功持久化后才视为当天完成；失败采用最多 4 次的有界退避，并使用运行锁阻止一分钟轮询重复并发。
- [x] 已完成：摘要内容、来源元信息、生成时间和手动/自动方式随用户 vault 加密保存最近 7 天；历史净化会移除正文与 HTML。
- [x] 已完成：摘要页展示最近成功时间、生成方式、最近历史选择和失败后的“立即重试”入口。
- [x] 已完成：增加跨 UTC/本地零点、夏令时、跨零点运行、应用重连、模型失败退避、运行锁和同日去重的可控测试。
- [x] 已完成：规格与架构已同步 IANA 时区上报、4 次退避、7 天保留期、自动去重和正文不落库边界。

建议提交拆分：

1. `fix: schedule digests in the user timezone`
2. `feat: persist bounded digest history`
3. `test: cover retries midnight and duplicate prevention`

验收条件：

- [x] 已完成：失败状态记录下一次重试时间，达到上限前当天仍会自动尝试，界面也可立即手动重试。
- [x] 已完成：摘要历史加密存入 MySQL 用户 vault，重启后通过 `ai:digest:history` 恢复，净化测试证明正文与 HTML 不进入历史。
- [x] 已完成：调度器按持久化历史去重，服务层写入时再次按“日期 + 自动方式”替换，保证同日最多一份有效自动结果。

## B1：完整邮箱导航、分页与远程搜索

优先级：P1

建议分支：`feature/mailbox-navigation`

依赖：`R1`、`M1`

状态：已完成（2026-11-12）

目标：从固定“收件箱/已发送 + 最近 50 封”升级为可用的邮箱浏览能力，同时不引入本地全文索引。

任务：

- [x] 已完成：新增 `mail:folders` 契约，返回真实路径、稳定 ID、`SPECIAL-USE`、可选择与只读标志。
- [x] 已完成：`mail:list` 改为绑定文件夹 UIDVALIDITY 的 UID 游标分页，首屏 50 封并可继续加载更早邮件。
- [x] 已完成：主题、发件人、起止日期和已读状态均转换为 IMAP 服务端搜索条件，最多提供最近 200 条并显示截断提示。
- [x] 已完成：Renderer 按账户记忆文件夹与查询；文件夹消失或不可选择时回退至收件箱或首个可用文件夹。
- [x] 已完成：增加 QQ/163 已发送、草稿、垃圾邮件、归档及不可选择/只读能力测试；归档写操作只接受服务端 `\\Archive` 标记，不按名称猜测。
- [x] 已完成：邮件页展示文件夹加载、列表加载、空结果、移动/删除警告、搜索截断和继续加载状态。

建议提交拆分：

1. `feat: expose mailbox folders and capabilities`
2. `feat: paginate remote mail summaries`
3. `feat: add bounded IMAP search filters`
4. `test: cover provider folder variants and pagination`

验收条件：

- [x] 已完成：真实文件夹导航和 Renderer 回归测试证明可切换文件夹并使用游标加载第 50 封之前的邮件。
- [x] 已完成：搜索测试验证条件直接交给 IMAP `SEARCH`，仅下载最多 200 条匹配元信息，不进入本地索引或 AI。
- [x] 已完成：UID 游标忽略分页期间新增的高 UID 邮件，Renderer 按“文件夹 + UID”去重；移动/删除导致的缺项会返回可见警告。

## C1：账户维护与连接健康状态

优先级：P2

建议分支：`feature/account-maintenance`

依赖：`R1`

状态：已完成（2026-11-12）

目标：授权码失效时无需删除账户重建，并能判断问题发生在 IMAP、SMTP 还是网络。

任务：

- [x] 已完成：新增授权码更新 API，候选凭据通过 IMAP 与 SMTP 验证后才原子写入 vault，失败时不修改旧凭据。
- [x] 已完成：新增只读账户健康检测，独立返回 IMAP、SMTP 状态及最近检查时间，错误信息不携带服务商详情或凭据。
- [x] 已完成：更新操作只接受账户 ID 与新授权码，服务商和地址保持不可变；变更身份仍需新增账户。
- [x] 已完成：设置页逐账户显示收件/发件状态、最近检查、重新验证和更新授权码入口，授权码输入始终为空。
- [x] 已完成：补充更新成功、失败回滚、验证期间并发删除、会话变化、独立连接状态及 Renderer 回归测试。

建议提交拆分：

1. `feat: update mailbox credentials atomically`
2. `feat: show per-account connection health`

验收条件：

- [x] 已完成：单元与 MySQL 集成测试证明验证失败不会覆盖仍可用的旧授权码。
- [x] 已完成：API 仅返回净化后的健康状态，日志不记录授权码，界面不回显已保存的授权码。

## O1：撰写、附件与诊断的后续增强

优先级：P2，可拆为多个独立 PR，不建议一次全部实现。

候选子模块：

- [ ] `feature/saved-drafts`：加密保存有限数量的本地草稿；关闭窗口前提示未保存修改；发送成功后移除对应草稿。
- [ ] `feature/multiple-recipients`：把单字符串收件人升级为结构化 `to/cc/bcc`，逐地址校验；兼容已保存的 Agent 历史草稿。
- [ ] `feature/safe-attachment-download`：按需下载附件，限制单个/总大小，净化文件名，由用户选择保存位置；附件默认不交给 AI。
- [ ] `feature/redacted-diagnostics`：增加本地轮转诊断日志和“一键导出诊断信息”，自动排除授权码、API Key、会话令牌和邮件正文。
- [ ] `chore/platform-packaging`：在 macOS 流程稳定后增加 Windows 打包与启动验证；不同平台分别记录 Docker 和安全存储前置条件。

每个子模块都必须独立建分支、独立验收；不要用一个“大而全”的邮件增强 PR 合并。

## 暂不建议进入当前路线图

- 自动发送邮件或让模型绕过预览/确认流程。
- 把邮件正文、附件或完整 AI 输入长期写入数据库。
- 为首版引入离线全文索引、向量数据库或通用模型工具执行框架。
- 在没有真实 QQ/163 测试账户和回归用例时扩展更多服务商。
- 仅为减少文件行数而创建过度抽象、插件系统或新的全局状态框架。

这些方向会扩大安全面和维护成本，且不解决当前最明显的可靠性与协作问题。

## 完成定义

单个模块只有同时满足以下条件才可勾选完成：

- [ ] 模块任务与验收条件全部通过，未完成项明确移入新编号而非静默删除。
- [ ] 自动化测试与对应手工主链路验证通过。
- [ ] 共享契约、业务文档和代码保持一致。
- [ ] `git status` 只包含本模块文件，没有临时日志、构建产物或调试输出。
- [ ] PR 可单独回滚，不依赖同批其他未合并分支才能恢复运行。
- [ ] 合并后删除已完成的远程和本地主题分支，保持分支列表整洁。
