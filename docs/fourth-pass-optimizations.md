# 第四轮排查：安全 / 易用性 / 剩余性能 / 可诊断性 优化项

> 生成时间：2026-09-20 · 定位：前四轮已闭环「性能 P0」「可靠性/公平性/测试盲区 12 项」「架构模块」，本文件为**后续可优化项排查清单**（尚未实施，供按优先级挑选）。
> 每条含代码位置、问题、建议、验证方法。核心前提：个人本地工具，单机、SQLite、无重型依赖（遵守 AGENTS.md）。

---

## 一、安全

### S-1. 页面/API 无任何访问控制——本机任何进程、局域网任意机器可读写【L2】

**位置**：`src/app/api/**`（16 个 route 全部无鉴权）、`next start` 默认监听 0.0.0.0（启动日志实测 `Network: http://169.254.33.126:3457`）

**问题**：`next start` 会把服务暴露到局域网。后果链：
- 任何能访问到端口的人都能：读全部 prompt（可能含密钥提示词/商业代码）、读全部源码产物（`/api/matches/:id/file`）、读轨迹、**触发新对局**（`POST /api/matches`，消耗你的 LLM 额度）、**续聊/重跑/删对局**（`DELETE`）；
- 同机恶意进程甚至能经 `screenshot` 路由驱动本机 Chrome（有 `--no-sandbox`）截图任意 workdir 文件内容。

个人工具定位下威胁模型有限（家庭/办公网），但**零门槛**值得补一个低成本的：
- `next start` 改为只监听 `127.0.0.1`（`next start -H 127.0.0.1`，或 README 明示）；这是零代码最有效的一档；
- 进阶：`withMatch` 统一入口加一个 `ARENA_TOKEN`（可空）校验——为空则仅限 localhost 访问（`req.ip` 判 127.0.0.1），非空则 Bearer 校验。约 15 行，一次覆盖 16 个路由。

**验证**：局域网另一台机器访问 `http://<host>:3000`——设 `-H 127.0.0.1` 后应无法连接。

### S-2. `--dangerously-skip-permissions` 无豁免，agent 可任意读写宿主机【L2 · 设计取舍】

**位置**：[claude-code.ts:27](src/lib/arena/adapters/claude-code.ts#L27)、[qoder.ts:31](src/lib/arena/adapters/qoder.ts#L31)、codex `--sandbox workspace-write`、codebuddy `-y`

**问题**：3 个 harness 都以跳过权限确认的无头模式运行。代码注释的判断是「运行在隔离的临时 workdir（ADR-0001），无需权限」——但 workdir 只是逻辑隔离，**没有 sandbox/容器**（ADR-0001 明说无 Docker）。agent 若能读写绝对路径（`Write` 工具给绝对路径、`Bash` 跑任意命令），就能碰 `~/.ssh`、`.env.local`、其他项目。这是个人工具的可接受取舍，但值得：
- README/文档显式写明「agent 以无权限确认模式运行，可读写本机；只应跑可信题目」——现在完全没提；
- 低成本加固：seedWorkdir 时把 `~/.ssh`、项目 `.env*`、`ARENA_API_KEY` 等敏感件从**探测范围外**排除（已有 EXCLUDED 名单，只排目录不排文件）；runner 的 env 注入 `process.env` 全量——至少**不让 agent 子进程看到 `ARK_API_KEY`**（很多 CLI 会把 env 里的大写键当配置读走）。这两点改动都很小。

**验证**：开一局后检查该 run 的子进程环境变量是否含 ARK_API_KEY（`ps e`/Windows 下 tasklist /v）；应不含。

### S-3. 报告/产物下载无敏感信息脱敏【L3】

**位置**：[report.ts](src/lib/arena/report.ts)、`/api/matches/:id/file`

**问题**：HTML 报告（`buildMatchReportHtml`）把**完整最终回答**、prompt、全部产出文件路径放进可分享单文件——如果 agent 在回答里复述了密钥/路径，分享出去就泄露。加上 S-1 的鉴权缺失，报告端点等于对外开了一个「读任意对局内容」的口。

**建议**：报告导出保留现状（本地工具自己导出无所谓），但文档里加一句「报告含模型原始输出，勿公开分享」；若走 S-1 的 token，报告端点自动被覆盖。

### S-4. 进程注入面：`ARENA_FAKE_CMD` 环境变量可被本机任意进程预设【L3】

**位置**：[runner.ts resolveFake](src/lib/arena/runner.ts#L253)

**问题**：`ARENA_FAKE_CMD_<harness>` 让 runner 用指定命令替代真实 CLI。同机恶意进程若在服务启动前设好该 env 再拉起服务，就能让「对局执行」变成任意代码执行——但这是本机工具，启动服务的用户本就拥有机器全部权限，威胁模型内无差别。仅记录，不建议为此加防护（会牺牲 fake 测试机制）。

---

## 二、易用性

### U-1. 首次使用无「环境准备」引导：装好 CLI、配好密钥、启动即用【L2】

**现状**：依赖 7 个 CLI（claude/codex/opencode/traecli/codebuddy/qodercli/pi）+ 方舟密钥（`.env.local`），但首页没有「缺哪些 CLI / 缺密钥」的一体化提示。detect 结果只在 ModelSelect 附近展示，`.env.local` 缺失只在点「一句话解析」时才报 503「未配置 ARK…」。

**建议**：首页顶部加一个轻量 readiness 横幅（数据已全在 detectAll + parser 的 no-credentials 分支里）：
- 「已就绪：5/7 个 CLI 已安装 · 已配密钥」或「未配置 ARK 密钥：一句话解析不可用，可手动配置」；
- 每个缺失 CLI 列安装提示。纯前端拼接，约 40 行。

**验证**：清掉 `.env.local` 刷新首页，横幅应出现密钥缺失提示；装齐后消失。

### U-2. 15 分钟总超时不可配（全局写死），单条慢题想放宽得重启改 env【L2】

**位置**：[runner.ts:21](src/lib/arena/runner.ts#L21)（`ARENA_TIMEOUT_MS` 是全局 env）

**问题**：`ARENA_TIMEOUT_MS` 只支持进程级 env，开跑后无法改。对某道「需要 20 分钟」的题只能整站重启换环境变量，且所有组合一起改。

**建议**：per-match 覆盖——`createMatch` 时读 `ARENA_DEFAULT_TIMEOUT_MS`，matches 表加 `timeout_ms` 列（可空=用全局），runMatch/executeTurn 传参。成本低（一列 + 传参），但属于 schema 改动，走 drizzle-kit。也可先不做，仅记录「全局 env 已可配」作为现状。

### U-3. 轨迹长对局前端仍全量渲染（performance-review 遗留的 P1）【L1 · 剩余性能】

**位置**：[TrajectoryView.tsx](src/components/TrajectoryView.tsx)、match/[id]/page.tsx 的事件 state

**现状**：第一轮已把 SSE 改为 100ms 批量合并入 state（P0 修掉了卡死主因），但**轨迹渲染仍是全量**——`TrajectoryView` 对全部事件 `visible.map` 建 `EventBlock`（含 `motion.div`）。几千事件的轨迹，展开时 DOM 节点数依然庞大，滚动会掉帧。performance-review 的 P0-1 建议里「虚拟化/窗口渲染」未落地（当时优先做了批量入 state）。

**建议**：窗口渲染——只渲染可视区 ± buffer（自实现 4-5 行上下哨兵高度占位，不引虚拟列表库，符合轻量原则）；或折叠「已读区」默认收起、只展开尾部。

**验证**：造 3000 事件轨迹，展开后 Performance 录制；窗口渲染后长任务数应下降一个量级。

### U-4. 报告导出「最终回答完整未截断」与「默认 markdown 截 2000 字」行为不一致【L3】

**位置**：[report.ts:50](src/lib/arena/report.ts#L50)、HTML 报告 footer「最终回答完整未截断」

**问题**：markdown 默认截 2000 字、`full=1` 才完整；HTML 则恒完整。两个导出通道语义不一致，且 HTML 报告体积可能因完整回答膨胀。

**建议**：统一——HTML 也加 `full` 控制（默认截断），或至少在文档里写明差异。小改。

---

## 三、可诊断性 / 运维

### D-1. 无日志落盘：整站唯一日志是 startup 的 console.log【L2】

**现状**：跑起来后「为什么这个 run failed」只能靠 DB 的 error 字段 + trajectory。runner 的 warn/error 都进轨迹了，但**没有进程级日志**——服务崩溃、路由 500、子进程 spawn 失败，都无处查。

**建议**：一个 `src/lib/arena/logger.ts`（`appendFileSync` 到 `.arena/arena.log`，含时间戳 + 事件类型 + 关键字段），runner 的 emitRunStatus、executeTurn 的失败/超时/停止、instrumentation 收敛、SSE 连接，各打一条。个人工具不需要 log 轮转/级别，~40 行。

**验证**：故意让一个 run 超时，`.arena/arena.log` 应能追溯「何时启动、何时判定超时、何时落库 failed」。

### D-2. SSE 断线无可见重连状态（服务端无感知）【L3】

**位置**：[stream/route.ts](src/app/api/matches/[id]/stream/route.ts)

**现状**：前端已有 `sseConnected` 状态（首轮性能修复加过断流提示），但服务端对「订阅者是否还活着」无感知——`req.signal` abort 才清理。若某对局跑了 20 分钟、浏览器标签中途关闭，服务端会继续给已死的流 enqueue（直到 abort 触发）。本地工具影响小，但 `ping` 心跳 + abort 清理已有，属「够用」。

**建议**：仅记录，不处理。真正值得的是：SSE 断线后前端**重连时补拉缺失事件**（现在靠轮询兜底 + 全量回放，已覆盖）。

### D-3. `.arena/` 数据只增不减：DB 无清理策略【L2】

**位置**：`.arena/`（当前 64K，但 trajectory + workdir 拷贝 + 截图 `shots/` 随对局数线性增长）；`deleteMatch` 已删 DB+磁盘，但没有「批量清理/归档」

**问题**：每局 = 每个 run 一份 workdir 拷贝（seedWorkdir 全量复制题目源码）+ trajectory + 可选截图。跑 100 局后 `.arena/` 可能上 GB（workdir 拷贝是主要大头）。当前无容量管理。

**建议**：
- 低成本：history 页加「清理已完成对局」批量入口（`deleteMatch` 已有单删，批量就是循环 + 确认）；
- 中成本：`ARENA_KEEP_WORKDIR_DAYS`——completed 对局超过 N 天自动删 workdir 目录（保留 DB 与 trajectory），可写进 instrumentation 启动收敛里顺带跑。

**验证**：跑若干对局后观察 `.arena/` 体积；执行批量清理后应显著回落。

---

## 四、演进成本 / 其他

### E-1. 加第 8 个 harness 的实际成本：一次全链路验证【已实测成本低，维持现状】

**结论**：按 AGENTS.md 第 5 条，新 harness = adapter（buildCommand + createParser）+ registry 注册 + meta 表一行 + fixture + 测试。T-1 半集成用例已证明「PATH shim 可全链路测」，所以**加 harness 的测试成本已降到可接受**。无需改动，仅记录——这是架构 review 已确认的正面结论。

### E-2. `combos` 以 JSON 字符串存列，跨版本演进需手动迁移【L3】

**位置**：[schema.ts:6](src/lib/db/schema.ts#L6)（`combos: text`）

**问题**：combo 结构（未来可能加温度/多轮参数）演进时，历史行是旧 JSON，读端（`getMatchCombos` 的 `JSON.parse`）会因字段缺失静默拿默认。个人工具量级 OK，但值得在 schema 注释里写明「combos 是演进敏感字段，改结构需迁移或宽容解析」。

**建议**：`getMatchCombos` 解析失败时返回 `[]` 且打日志（现在 `JSON.parse` 抛错会 500）。小改。

### E-3. 文档零散：CONTEXT.md / AGENTS.md / README / 4 个 ADR 各自为政【L3】

**现状**：领域术语统一得很好（CONTEXT.md），但「怎么部署/怎么配密钥/怎么加题目/怎么加 harness」散落在各处，没有一份「本地工具使用指南」。

**建议**：README 补「快速开始」（装 CLI → 配 `.env.local` → `npm run dev` → 首次对话）、「如何加题库」「如何加 harness」。纯文档，成本低，价值高（新机器/换机场景）。

---

## 五、按影响/成本排序的建议优先级

| 优先级 | 项 | 成本 | 收益 |
|---|---|---|---|
| **P1** | S-1 监听回环（`next start -H 127.0.0.1`） | 0 代码 | 关掉局域网暴露面 |
| **P1** | S-2 agent 子进程不继承 `ARK_API_KEY` + 文档明示权限模型 | 小 | 防 key 被 agent 读走 |
| **P1** | U-3 轨迹窗口渲染 | 中 | 长对局滚动不卡（性能剩项） |
| **P2** | D-3 批量清理 + workdir 保留策略 | 小-中 | 数据只增不减收敛 |
| **P2** | U-1 readiness 横幅 | 小 | 新用户上手路径清晰 |
| **P2** | D-1 日志落盘 | 小 | 崩溃/失败可追溯 |
| **P2** | S-1 进阶 token（可空，默认仅 localhost） | 中 | 覆盖 16 路由 |
| **P3** | U-2 per-match 超时、U-4 报告一致性、E-2 combos 宽容解析、E-3 README | 小 | 各自局部 |

**不建议做**：S-4（fake env 注入面，威胁模型内无差别）、D-2（SSE 服务端感知，已够用）。

> 备注：第四轮为**排查清单**，未改代码；若需要，可从 P1 三项（S-1/S-2/U-3）开始逐项落地。
