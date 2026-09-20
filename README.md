# Model-Agent Arena（Agent 竞技场）

本地个人工具：用同一条提示词并排对比多个「harness × 模型」组合的执行过程与结果（修复 bug / 实现功能 / 产出网页）。

## 快速开始

前置：Node.js 20+，本机已安装至少一个要对比的 CLI（claude / codex / opencode / traecli / codebuddy / qodercli / pi），
并准备一个方舟（Volcano Ark）API Key。

```bash
# 1. 配置密钥（仅本地，不入库；未配置时"一句话解析"不可用，可手动配置对局）
cp .env.example .env.local   # 编辑填入 ARK_BASE_URL / ARK_API_KEY / ARK_MODEL

# 2. 开发模式
npm install
npm run dev
# 生产模式（默认仅监听 127.0.0.1，不暴露到局域网）
npm run build && npm start

# 3. 打开 http://localhost:3000
```

## 使用

- 首页输入一句话（如「对比 claude 和 codex 修好 debounce 的 bug」），确认解析结果后开跑；
- 对局页实时看轨迹（SSE）、预览产物、续聊、重跑、导出报告、视觉对比；
- 题库：内置 `questions/`（算法 / JS bug / 网页小游戏），用户题库放 `.arena/questions/`。

## 安全与权限模型（重要）

- `npm start` 默认只监听 `127.0.0.1`。若需局域网访问，手动 `next start -H 0.0.0.0`，并知晓：
  **本服务无鉴权**，能访问端口的人可读取所有对局内容（prompt、源码产物、轨迹）并可触发对局（消耗你的 LLM 额度）。
- **agent 以无权限确认模式运行**（claude `--dangerously-skip-permissions` / codex `--sandbox workspace-write` / codebuddy `-y` 等），
  可读写本机文件、执行命令——请只运行**可信题目**。运行目录是临时 workdir（ADR-0001，无容器沙箱）。
- agent 子进程**不会继承** `ARK_API_KEY` 等密钥环境变量（见 `runner.ts` 的 env 过滤）；密钥只经 `.env.local` 注入服务端。
- **导出报告含模型原始输出与 prompt**（可能复述密钥/内部路径），请勿公开分享；报告默认截断最终回答 2000 字，导出完整版用 `?full=1`。

## 题库

- 内置题库在 `questions/<题库>/<题目>/`：`bank.json`（题库元信息）+ `question.json`（题目元信息）+ 题目项目目录。
- `bank.json` 可选字段：`name`、`description`、`previewHint`（布尔，默认 true；算法/bug 修复类题库设 `false` 可去掉"起本地服务"的提示词噪声）。
- 用户题库放 `.arena/questions/`（运行时数据，不入库，同名题库覆盖内置）。
- 新增题目：在题库目录建题目文件夹，放 `question.json`（`title`/`description`/`prompt`）+ 代码 + `package.json` 的 `test` 脚本（有测试才会跑修复验证）。

## 配置项（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ARK_BASE_URL` / `ARK_API_KEY` / `ARK_MODEL` | — | 一句话解析（LLM 配置解析器） |
| `ARENA_DB` | `.arena/arena.db` | SQLite 数据库路径 |
| `ARENA_WORKDIR_ROOT` | 系统 tmp 下的 `model-agent-arena/runs` | 运行工作目录根 |
| `ARENA_CONCURRENCY` | 3 | 全局并发子进程数 |
| `ARENA_TIMEOUT_MS` | 15 分钟 | 单 run 总超时 |
| `ARENA_IDLE_TIMEOUT_MS` | 5 分钟 | 静默看门狗（无任何事件则自动停止） |
| `ARENA_VERIFY_TIMEOUT_MS` | 5 分钟 | 修复验证超时 |
| `ARENA_KEEP_WORKDIR_DAYS` | 0（不清理） | 启动时清理超过 N 天的已结束对局 workdir（释放磁盘） |
| `ARENA_NET_ERR_LIMIT` | 3 | 连续网络错误自动停止阈值 |
| `ARENA_PREVIEW_PORT_BLACKLIST` | — | 预览地址黑名单端口（逗号分隔） |
| `ARENA_FAKE_CMD` / `ARENA_FAKE_CMD_<harness>` | — | 测试替身命令（测试用，勿在生产设置） |

## 目录结构

```
src/app         页面与 API 路由（16 个 route，边界均 zod 校验）
src/lib/arena   领域层：runner 执行引擎、adapters（7 个 harness）、parser/verify/pricing/report/…
src/lib/db      Drizzle + better-sqlite3（matches/runs 两表）
questions/      内置题库（bank.json + 题目目录）
tests/          vitest（23+ 文件，fixture 驱动，不依赖真实 CLI）
docs/           评审报告（architecture / performance / tri-review / fourth-pass）与 ADR
```

## 开发约定

见 [AGENTS.md](AGENTS.md)（领域术语、zod 边界、adapter 归一化、密钥安全、测试要求等）与 [CONTEXT.md](CONTEXT.md)（术语表）。

## 新增 harness

按 AGENTS.md 第 5 条：实现 `HarnessAdapter`（buildCommand + createParser），注册到 `adapters/registry.ts`，
在 `adapters/meta.ts` 加一行，补 fixture 与测试（可参考 `tests/arena/runner.test.ts` 的 PATH shim 半集成用例，不依赖真实 CLI 登录态）。
