# Fixture 采样版本表

fixture 是从真实 CLI 采样的事件流固定样本（AGENTS.md 第 9 条：adapter 测试禁止依赖真实 CLI 登录态）。
CLI 升级可能改变事件格式——若真实对局解析异常而测试全绿，先对照下表检查 CLI 版本是否已领先采样版本，
然后用新版本重新采样替换 fixture（保持覆盖的事件类型不缩水），并更新本表。

| harness | CLI 实名（spawn 用） | 采样版本 | 采样时间 | fixture | 覆盖事件 | 备注 |
|---|---|---|---|---|---|---|
| claude-code | `claude` | Agent Plan 接入当日 | 2026-09 | claude-code.jsonl | system/init → assistant(text/tool_use) → user/tool_result → result(usage) | 与 codebuddy/qoder 同构族（claude-family parser） |
| codex | `codex` | Task 0 实测 | 2026-09 | codex.jsonl | item.completed(agent_message/reasoning/command_execution/file_change)、turn.completed(usage)、turn.failed | done 由 flush 发出（usage 在 turn.completed 才可得） |
| opencode | `opencode` | 2026-09-13 实测 | 2026-09-13 | —（测试内联样本） | text、step_finish(tokens 累加)、step_start、error、tool_use | 无独立 fixture 文件，样本写在 opencode.test.ts 内 |
| trae | `trae` | traecli 0.120.52 | Task 0 | trae.jsonl | system/init、result(usage + total_cost_usd)、assistant | |
| codebuddy | `codebuddy` | codebuddy 2.150.0 | Task 0 | codebuddy.jsonl | 同 claude-family 族；errors 数组错误形态 | `-y` 非交互必需 |
| qoder | `qodercli` | qodercli 1.1.51 | Task 0 | qoder.jsonl | 同 claude-family 族 + hook_* 噪音子类型 | **采样时账户额度耗尽**：tool_use/tool_result 真实样本未采到，解析路径按同族约定实现，额度恢复后应跑真实对局复核（adapter 注释同） |
| pi | `pi` | pi 0.85.1 | Task 0 | pi.jsonl | message_update(delta + 顶层累计 usage)、agent_end | usage 跨行取最新 |

维护约定：
1. 新增/重采 fixture 时，在本表登记 CLI 版本与采样时间（版本号从 `detect` 的 detail 或 `<cli> --version` 取）。
2. adapter 测试只允许消费 fixture/内联样本，禁止现场调 CLI。
3. CLI 大版本升级后：跑一局真实对局，把 `runs/<matchId>/<runId>/trajectory.jsonl` 中解析正确的事件行
   节选为新 fixture；若事件形状变化导致 parser 需要改，先改 parser 再更新 fixture 与测试。
