<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# model-agent-arena 编码规范（必须遵循）

1. **技术栈与目录结构**：Next.js App Router + TypeScript，代码一律放 `src/`（`app/`、`components/`、`lib/`），导入别名用 `@/*`。保持个人本地工具的轻量，不擅自引入计划之外的重型依赖（无 Docker、无消息队列、无第三方状态库）。

2. **Next.js 版本差异**：本项目 Next.js 与训练数据可能不同，写任何页面/路由/API 前先查 `node_modules/next/dist/docs/` 对应指南，遵循其中的新 API 与约定，废弃 API 禁止使用。

3. **领域术语统一**：代码标识符、注释、UI 文案、API 字段一律使用 `CONTEXT.md` 术语：Harness、组合（Combo）、对局（Match）、运行（Run）、轨迹（Trajectory）、指标（Metrics）；禁用其 `_Avoid_` 词（如 session、job、trace、评分）。

4. **边界必须 zod 校验**：所有外部输入（API route 请求体、一句话解析结果、harness 输出事件）必须经 zod schema 校验；schema 与领域类型集中定义在 `src/lib/arena/types.ts`，类型用 `z.infer` 导出，不手写重复 interface。

5. **Adapter 归一化**：每个 harness adapter 只做一件事——把自家 JSONL 事件流翻译成统一的 `ArenaEvent`；新增 harness 必须实现 `HarnessAdapter` 接口并注册到 `adapters/registry.ts`，禁止为某个 harness 修改 runner 核心或绕过 `ArenaEvent` 直接输出。

6. **密钥安全**：LLM 密钥只经 `.env.local` 环境变量注入（`ARK_BASE_URL` / `ARK_API_KEY` / `ARK_MODEL`），禁止硬编码、禁止写入任何入库文件、禁止打印到日志或轨迹内容中。

7. **执行引擎硬约束**：裸跑临时目录（无 Docker/Harbor，ADR-0001）；并发默认 3（p-limit）；单 Run 超时 15 分钟；单组合失败标记 `failed`，不得阻塞其他组合；Windows 下 spawn 统一 `shell: true`（CLI 是 `.cmd` shim）。

8. **持久化边界**：表定义只写在 `src/lib/db/schema.ts`（Drizzle + better-sqlite3），改表走 drizzle-kit；轨迹按 `runs/<matchId>/<runId>/trajectory.jsonl` 文件存储；全部运行时数据只放 `.arena/`，不得提交到 git。

9. **测试要求**：解析、估算、runner 等纯逻辑必须有 vitest 单测（`tests/`，node 环境）；adapter 测试一律以 `tests/fixtures/*.jsonl` 固定样本驱动，禁止依赖真实 CLI 登录态。提交前 `npm run lint` 与 `npm test` 必须通过。

10. **确认后执行**：一句话解析出的配置必须回显给用户确认后才创建对局（ADR-0004），禁止跳过确认直接执行；实时数据一律走 SSE（进程内 EventEmitter 总线 + `ReadableStream`），UI 样式只用 Tailwind CSS，注释与文档用中文。
