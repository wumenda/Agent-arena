# Agent 竞技场 — 功能实现与架构分析报告

> 生成时间：2026-09-13 · 分析范围：`src/` 全部代码、`tests/`、`docs/adr/`
> 分析框架：「深度模块」——接口小、实现厚、缝隙清晰、可测性自然

---

## 一、项目定位与模块地图

个人本地工具：同一条提示词并排对比多个「harness × 模型」组合的执行过程与结果。

```
页面层 (src/app/page.tsx, match/[id], history, stats)
   │  fetch + SSE(EventSource)
API 路由层 (src/app/api/**, 16 个 route.ts)
   │
lib 领域层 (src/lib/arena/*)
   ├─ parser.ts      一句话配置（LLM → MatchConfig，zod 校验）
   ├─ runner.ts      执行引擎（spawn、看门狗、指标、轨迹、广播）
   ├─ adapters/*     7 个 harness 适配器 + registry + model-probe
   ├─ bus.ts         进程内 EventEmitter 总线（SSE 数据源）
   ├─ verify.ts      修复验证（反作弊：恢复原始测试）
   ├─ shot/files/diff/report/pricing/estimator/questions/seed/proc/paths
DB 层 (src/lib/db/*)  Drizzle + better-sqlite3，matches/runs 两表
磁盘 (.arena/ + tmp)  runs/<matchId>/<runId>/trajectory.jsonl
```

---

## 二、功能实现情况盘点

| 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 一句话配置（LLM 解析） | ✅ 完整 | `parser.ts` + `api/parse` | 密钥走 env；失败语义静默折叠为 null（见 P1-6） |
| 确认后执行（ADR-0004） | ✅ 完整 | `ConfigForm.tsx` | 解析结果回显可编辑，确认才 POST |
| 7 个 harness 适配器 | ✅ 完整 | `adapters/` | claude-code / codex / opencode / trae / codebuddy / qoder / pi |
| 执行引擎 | ✅ 完整 | `runner.ts` | 并发 3（p-limit）、15 分钟总超时、5 分钟静默看门狗、网络错误连续 3 次自动停止、单组合失败不阻塞 |
| 会话续聊 | ✅ 完整 | `continueRun` | 3 个 harness 支持（claude-code/codex/opencode），指标累加、同轨迹追加 |
| 同对局重跑 + 血缘 | ✅ 完整 | `rerunCombos` + `parentMatchId` | 新旧 runs 同屏，血缘链防环 |
| 轨迹记录与回放 | ✅ 完整 | `trajectory.jsonl` + `api/trajectory` | JSONL 逐行，done 收尾保证 |
| 实时推送（SSE） | ✅ 完整 | `bus.ts` + `api/stream` | 进程内总线 + ReadableStream，20s 心跳；轮询 5s 兜底 |
| 指标采集 | ✅ 完整 | `runner.ts:94-108` + `pricing.ts` | CLI 自报成本被弃用，统一按 tokens × 单价重算（正确决策） |
| 成本预估 | ⚠️ 可用但粗 | `estimator.ts` | 按模型名分 4 档固定区间，与 pricing 实价表独立维护（见 P1-9） |
| 修复验证（反作弊） | ✅ 完整 | `verify.ts` | `git ls-files` 恢复原始测试再跑 `npm test`，防 agent 改测试自证 |
| 服务预览 + 视觉对比 | ⚠️ 有安全缺口 | `files.ts` + `shot.ts` + `api/screenshot` | URL 嗅探、截图、pixelmatch 像素对比；但 screenshot 路由有路径穿越风险（见 P0-1） |
| 报告导出 | ✅ 完整 | `report.ts` | Markdown 格式，含指标对比表与最终回答 |
| 历史与统计页 | ✅ 基础完整 | `history/page.tsx` / `stats/page.tsx` | 无实时刷新，一次性快照（见 P2-4） |
| 测试体系 | ✅ 扎实 | `tests/` | 纯逻辑单测 / fixture 驱动 / `:memory:` 库 / 真实 spawn 替身全链路 |

**总体判断**：核心功能闭环完整，README 承诺的能力全部落地，无半成品路由或死页面。测试策略是同类个人项目中的高水准——`ARENA_FAKE_CMD` 替身通道让 runner 测试走**真实 spawn 路径**而不依赖真实 CLI 登录态，这是全项目设计最扎实的一块。

---

## 三、架构现状评价（优点先行）

1. **runner 是真正的深度模块**。接口只有 `runMatch` / `continueRun` / `stopRun` 三个函数，实现却收编了看门狗、网络错误熔断、指标累加、成本重算、预览嗅探、轨迹落盘、SSE 广播、失败隔离八类行为。调用方（路由层）只需一行 `void runMatch(id)`。这是全项目杠杆最高的一处设计。
2. **HarnessAdapter 缝隙选位正确**。`buildCommand → SpawnCommand`、`createParser → LineParser` 把「各 harness 的方言差异」全部关在 adapter 内，runner 核心零修改即可新增 harness，符合规范第 5 条。
3. **路由层薄透传 + lib 层承载领域**的大方向执行到位（`questions`/`stats`/`detect` 是理想形态），`deleteMatch` 的拒绝语义、`files.ts` 的路径穿越防护都下沉在了正确的层。
4. **数据层刻意薄**：两表、同步 API、轨迹走文件而非 DB，匹配「个人本地工具轻量化」定位，没有过度设计。
5. **前端单向流为主**：对局页 owns 全局状态（runs/events），SSE + 轮询双通道喂数据，卡片纯展示。

---

## 四、问题与优化建议

### P0 — 正确性与安全（建议立即处理）

#### P0-1 `screenshot` 路由路径穿越 + 无校验

`src/app/api/matches/[id]/screenshot/route.ts` 中 `side.path` 直接 `path.join(run.workdir, side.path)` 后 `readFileSync`，**没有走 `files.ts` 的 `safeResolveFile`**；body 也未过 zod。传 `../../.env.local` 即可读取 workdir 之外文件并经截图流程回显。同项目的 `/file` 路由有防护、`/screenshot` 没有，属于防护不一致。
**建议**：body 过 zod（可复用 `PreviewUrlSchema` 的 refine 风格），文件读取统一走 `safeResolveFile`。

#### P0-2 adapter 事件边界绕过 zod（违反工作区规范第 4 条）

规范要求「harness 输出事件必须经 zod schema 校验」，但 7 个 parser 都是 `JSON.parse` 后以 `any` 直接属性访问（如 `claude-code.ts:41-75`）。字段名打错、CLI 信封升级只会静默产出空事件。`ArenaEvent` 是手写 union（`types.ts:37-48`），没有对应的 zod schema 可在边界复用。
**建议**：为每族事件定义 zod schema，`LineParser` 返回前 `safeParse`，失败降级为 `system` 事件（保留原文）而非丢弃——这样 CLI 变更时轨迹里能看到原始行，排查不靠猜。

#### P0-3 三处裸 `req.json()` 与错误格式三种混用

`stop`、`matches` POST、`screenshot` 裸调 `await req.json()`，非法 JSON 直接 500；错误响应格式三种并存（`{error}` / `{error: flatten()}` / `{ok:false, error}`），前端只能字符串兜底。
**建议**：抽一个 `readJson(req, schema)` 辅助函数（内部 try/catch + safeParse），所有 POST 路由统一返回 `{ error: string }`。

#### P0-4 `deleteMatch` 的破坏性目录删除依赖布局假设

`db/index.ts:114-117` 用 `dirname(runs[0].workdir)` 推断对局目录再 `rmSync(recursive, force)`。若两次对局之间 `ARENA_WORKDIR_ROOT` 被改过、或未来 workdir 布局调整，会静默删错目录（`force` 吞掉一切）。
**建议**：match 创建时把 `workdirRoot` 快照进 match 行（或由 `paths.ts` 提供 `matchDir(matchId)` 单一函数），删除前校验路径确在该 match 目录下。

#### P0-5 db 单例的隐式初始化契约

`db/index.ts:37-38` import 即建库，测试靠「第一行设 `ARENA_DB=':memory:'` 再 import」生效——ESM import 提升，若新测试把 import 排到 env 赋值前会**静默**写真实库。Next dev 热重载下也可能产生多个连接，且未设 `busy_timeout`。
**建议**：`globalThis` 缓存兜底 + 显式 `initDb(url)` 由调用方调用（或至少加 `busy_timeout` pragma），消除「import 顺序即正确性」的隐性接口。

#### P0-6 emit 与落库的时序耦合外溢到前端

`runner.ts:194-195` 先落库再广播终态，顺序本身正确；但指标/验证落库发生在其后（L204-205），晚于终态广播——这正是 `match/[id]/page.tsx:75-76` 需要「终态补拉」的根因。时序问题由前端双拉掩盖。
**建议**：把 verify/指标落库挪进 `executeTurn` 终态分支（在 emit 之前完成），前端补拉逻辑即可删除。

### P1 — 结构性优化（按「深度/缝隙」框架）

#### P1-1 同构族 parser 重复 ~150 行：提取共享 parser 工厂

Claude 同构族（claude-code / codebuddy / qoder / trae 四家事件信封几乎一致）的 content-blocks 循环在 `claude-code.ts:43-53`、`codebuddy.ts:49-59`、`qoder.ts:55-68` 三处几乎逐字符相同；`result → done` 的 usage 映射四处重复且细节不一致（cacheRead 回退 `?? 0` vs `?? undefined`）；`blocksText` 在三家逐字复制。
**建议**：提取 `createClaudeFamilyParser(fieldMap)` 深模块——接口是一个字段映射对象（`{usage: {...}, toolNameKey: "tool_name", ...}`），实现收编循环、映射、JSON 样板。估算净删 100-150 行，且 usage 空值语义强制统一。

#### P1-2 新增 harness 需手工同步 6 处清单 → 单一事实来源

`HARNESS_IDS`（`types.ts:3`）、registry 硬编码（`registry.ts:37-45`）、`HARNESS_CATALOG`×7 份重复的 models（`catalog.ts`）、`parser.ts:7` 的 SYSTEM_PROMPT 枚举、`CONTINUABLE_HARNESSES`（`types.ts:65`）。加 harness 漏改提示词，LLM 会产出非法名然后被 `safeParse` 静默拒绝。
**建议**：
- `CONTINUABLE_HARNESSES` 直接从 registry 派生（`Object.values(adapters).filter(a => a.buildContinueCommand)`），删掉手写白名单；
- catalog 从 adapter 导出派生（adapter 侧已是唯一真实来源，catalog 只是去掉 node 依赖的投影）；
- SYSTEM_PROMPT 构造时从同一来源生成枚举串。

#### P1-3 runner 内残留两条 adapter 职责泄漏

`runner.ts:256` 与 `runner.ts:289` 的 `if (cmd.file === "claude") cmd.stdin = taskPrompt`——runner 不该知道某个 harness 的 prompt 传递细节。同时 `SpawnCommand.stdin === "__PROMPT__"` 占位符是好缝隙，但 claude 特判绕过了它。
**建议**：claude-code adapter 改用 `stdin: "__PROMPT__"`（与其他 stdin 型 harness 统一），删除 runner 中的特判。`resolveFake`/`fakeLineEvents` 同理可下沉为独立的测试替身模块，让 runner 只依赖 `HarnessAdapter` 接口。

#### P1-4 路由层样板：抽 `withMatch` 高阶函数

「getMatch → 404」前奏在 7 个路由重复；「listRuns().find(runId)」在 4 个路由重复且与 `continue` 的 `getRun + matchId` 归属校验是同一语义两种实现；轨迹文件读取在 `report`/`trajectory` 两处重复且 report 侧不校验。
**建议**：
- `withMatch(handler)`：解析 id → 404 短路 → 传入 match；
- `requireRun(matchId, runId)`：统一 run 归属校验（以 continue 的实现为准）;
- `readTrajectory(runId)` 下沉到 `lib/arena/trajectory.ts`，report/trajectory/回放共用一处解析。

#### P1-5 screenshot 算法整体下沉 lib

`resolveHtml`、截图缓存判断、pixelmatch 对比、base64 编码全部内联在路由（`screenshot/route.ts:19-42`），`shot.ts` 只承担了 `findChrome/renderShot/hashKey`。
**建议**：`lib/arena/shot.ts` 增加 `diffShots(matchId, left, right)`，路由收缩为参数校验 + 调用 + 501 降级。

#### P1-6 parser.ts 失败语义全部折叠为 null

`parser.ts:30/36/38/39-41` 空 catch 把「未配密钥 / 网络失败 / LLM 输出漂移 / 校验失败」四种情况折叠成同一个 `null`，前端只能统一提示，排查靠猜。
**建议**：返回可辨识结果（`{ ok: true, config } | { ok: false, reason: "no_key" | "network" | "llm_format" | "invalid" , detail? }`），前端按 reason 提示。这是典型的「浅接口」——现在调用方要学习的失败知识全被藏进了 null。

#### P1-7 API 与前端之间的 DTO 缺失

`RunRow`（含 `workdir` 绝对路径）原样序列化给浏览器，`DiffView.tsx:12` 在客户端用 `run.workdir` 做字符串切割——本地文件系统路径泄露 + UI 组件与 DB schema 强耦合（6 个组件 import `RunRow`）。`lineage` 路由做了 DTO 裁剪，详情接口反而没做。
**建议**：详情接口统一裁剪为 `RunDTO`（id/status/metrics/verifyStatus…），产出文件一律走 `/file` 接口按需取，前端不再持有路径。`combos` 的 `JSON.parse` 也在 `history` 页出现 3 次 + `rerun` 路由 1 次 + runner 1 次，宜由 db 层提供 `getMatchCombos(id)` 收口。

#### P1-8 前端两套数据流并存

对局页是「页面 owns 状态 + SSE/轮询」单向流；但 `LineageChart`（仅挂载拉一次，重跑后看不到新的一代）、`PreviewGrid`、`RunDiff`、`FileViewer` 是组件自治 fetch——同一个 run 的文件列表被 4 个消费方重复调用 `/file`。
**建议**：不必引状态库（符合规范），最小改法是把「runs + events + 文件清单」的订阅收口到对局页（或一个 `useMatchData(matchId)` hook），自治组件全部改为 props 注入；`/file` 清单由页面拉一次下传。

#### P1-9 estimator 与 pricing 双口径无联动

estimator 的 4 档区间与 pricing 的 14 行实价表独立维护，确认页预估可能偏离实际一个数量级。
**建议**：estimator 优先查 pricing `TABLE`（同模型有实价直接算区间），无实价再走 tier 兜底——两表保留，但口径联动。

#### P1-10 前端工具函数多份拷贝

`STATUS_STYLE` 三份（`match/[id]/page.tsx:13-19`、`RunPanel.tsx:11-17`、`history/page.tsx:8-14`）；时长格式化 `fmt` 四份。
**建议**：收口到 `src/lib/arena/format.ts`（或 `src/components/` 下的共享常量），一次修复全局生效。

### P2 — 低优先级改进（记录备查）

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 1 | SSE 无 `retry:` 与断点续传，重连靠前端全量回放补偿 | `stream/route.ts` | 加 `retry: 3000` 即可，Last-Event-ID 对本地工具可不做 |
| 2 | `controller.close()` 在 abort 与心跳竞态时可能抛 `ERR_INVALID_STATE` | `stream/route.ts:19` | close 包 try/catch |
| 3 | runId 用 `Date.now()` 拼接，同毫秒撞键概率低但存在 | `runner.ts:306/327` | 换 `nanoid`（match 已在用） |
| 4 | `activeChildren`/`manualStops` 模块单例，dev 热重载后旧进程无法手动停止 | `runner.ts:33-34` | `globalThis` 缓存（与 P0-5 同一改法） |
| 5 | `ARENA_FAKE_CMD` 按空格 split，路径含空格会解析错 | `runner.ts:216` | 支持数组形式 env 或用引号解析 |
| 6 | `findChrome` 仅探测 Windows 路径，POSIX 静默降级 | `shot.ts:4-15` | 加 POSIX 常见路径 + 降级时在 UI 提示一次 |
| 7 | detect 缓存写在路由层，dev 热重载即失效 | `api/detect/route.ts:6-7` | 挪进 adapter registry（与 P1-2 同一收口方向） |
| 8 | pricing 表按顺序短路的宽泛正则（`/o\d/i`、`/gpt/i`）可能误匹配新模型名 | `pricing.ts:28` | 高优先条目放前 + 注释标注插入规则 |
| 9 | `getLineage` 每代 `listRuns` 的 N+1 | `db/index.ts:92-102` | SQLite 本地无感，血缘深时可改 IN 查询 |
| 10 | history/stats 页无实时刷新，running 对局停留在快照 | 两页面 | 加 5s 轮询即可（不必上 SSE） |

---

## 五、建议的实施顺序

依赖关系与收益排序（每步可独立验证，`npm run lint` + `npm test` 守护）：

1. **第一批（安全与正确性，改动小）**：P0-1 screenshot 校验与路径防护 → P0-3 统一 JSON 读取与错误格式 → P0-4 删除目录校验 → P0-6 时序收口（顺带删掉前端补拉补偿）。
2. **第二批（结构性重构，收益最大）**：P1-1 parser 工厂（净删 100-150 行）→ P1-2 harness 清单单源化 → P1-3 runner 特判清除 → P1-4/P1-5 路由样板收口。
3. **第三批（体验与一致性）**：P1-7 DTO 裁剪 → P1-8 数据流收口 → P1-6 parser 失败语义 → P1-9/P1-10。
4. **P0-2 / P0-5（zod 边界与 db 初始化）** 建议与第二批一起做：P1-1 重写 parser 时正好引入事件 schema，P1-2 改 registry 时正好处理单例。

**一句话总结**：功能实现完整、测试策略扎实、runner 与 adapter 两处缝隙选位正确；主要技术债集中在「同构族 adapter 的机械重复」「6 处手工同步清单」「路由层样板与 DTO 缺失」三个方向，以及 screenshot 路由一处应立即修复的安全缺口。按上述顺序推进，每一步都在既有规范（ADR-0001~0004、工作区 10 条编码规范）的框架内，无需推翻任何现有设计。
