# 性能优化评审（Performance Review）

> 目的：从性能与可扩展性角度审计 Agent 竞技场（Model-Agent Arena），定位瓶颈、给出可落地的优化建议与验证方法。
> 范围：前端渲染、SSE 实时通道、执行引擎（runner）、文件 IO、DB 与统计页。
> 原则：不引入重型依赖（无 Redis/消息队列/第三方状态库，遵守项目规范）；所有建议给出可验证的观测方式。

---

## 1. 总体判断

项目整体是**个人本地工具**定位（SQLite + 单进程 + 子进程 harness，ADR-0001 裸跑临时目录），数据规模小，多数"全表扫/全量读"问题在当前量级下不构成瓶颈。真正的性能风险集中在：

1. **长时间对局的浏览器端渲染**——每事件一次 setState + 轨迹全量渲染（无虚拟化），事件量大时卡死。
2. **多合一的双通道拉取风暴**——5s 轮询 + SSE 实时 + PreviewGrid 5s tick，完成态页面反复全量重拉。
3. **事件循环上的同步 IO**——每事件 `appendFileSync`、源目录同步 `cpSync`、轨迹全量 JSON.parse，全部跑在主线程。
4. **SSE 广播无节流**——每个事件对每个订阅者同步 JSON.stringify + enqueue。

---

## 2. 问题清单（按优先级）

### P0-1. 前端：每个 SSE 事件触发一次全量 state 更新 + 全量轨迹渲染

**位置**：[match/[id]/page.tsx](src/app/match/[id]/page.tsx#L67-L84)
**现状**：`run-event` 每到达一个事件就 `setEvents(prev => ({...prev, [runId]: [...prev[runId], event]}))`。对局持续 10+ 分钟会产生几千~上万事件，每次 setState：
- 全量 spread 已有数组（O(n) 复制）；
- 所有 `RunPanel` 重新渲染，其 `TrajectoryView` 对全部事件 `visible.map`（[TrajectoryView.tsx](src/components/TrajectoryView.tsx#L131-L140)）重建每个 `EventBlock`（含 `motion.div` 蒙版动画与 `tool_call` 的 `JSON.stringify`，[L72-L76](src/components/TrajectoryView.tsx#L72-L76)）。事件量 > 2000 时浏览器主线程明显卡顿。

**建议**：
1. **事件批量入 state**：SSE 回调只写入一个 pending buffer（普通数组/ref），每 100ms（`requestAnimationFrame` 或 `setTimeout`）合并 flush 一次 state。React 18 的自动批处理覆盖不到异步 SSE 回调，需手动积累。
2. **轨迹虚拟化/截断**：`TrajectoryView` 改为窗口渲染——只渲染可视区 ± buffer 条事件（自实现 4-5 行“上下哨兵高度占位”即可，不引虚拟列表库）；或在 `RunPanel` 内对超长轨迹做“懒加载前 N 条 + 滚动加载”的分页视图。
3. **动画降级**：新事件用 `motion` 首帧动画，但已渲染历史条目不要每次都包 `motion.div`（用 `key` 稳定性保证）。

> 验证：对局跑一个 5 分钟、产出 3000+ 事件的组合，Chrome DevTools Performance 录制；优化后主线程长任务（>50ms）数量应下降一个数量级。

### P0-2. 前端：完成态页面反复全量拉取（轮询 + 逐 run 轨迹重拉）

**位置**：[match/[id]/page.tsx](src/app/match/[id]/page.tsx#L40-L64)
**现状**：
- `setInterval(load, 5000)` 无条件每 5s 全量 `fetch(/api/matches/:id)`，即使对局已 `completed`；
- 初次/每轮 load 中对**每个 run** 逐个 `fetch trajectory`（L53-59），跑 n 个 combo 就 n 次串行请求；
- `load()` 的依赖闭包捕获初始 `events`（`[]`），轨迹补拉条件 `!events[r.id]` 实际只在首次命中——刷新后 `events` 为空数组，会重复全量拉一次。

**建议**：
1. 轮询只在 `match.status === "running"` 时进行；`completed/partial` 后停止轮询（终态由 SSE `match-status` 或最后一次 load 落定）。
2. 轨迹补拉并行化：`Promise.all` 拉所有 run 的 trajectory，而不是 for 循环串行。
3. 轨迹读取加**内存缓存**（见 P1-3），让重复拉取变成命中缓存而不是重读文件。
4. 轮询与 SSE 双通道保留合理——它们分别承担"断流兜底"与"实时"，但可通过 SSR 端判断对局是否 running 来决定前端首屏是否建立轮询。

> 验证：对局页 Network 面板，完成态停留 30s，优化前 5s 一次的批量请求应消失；首载只保留 1 次列表 + N 次（并行）轨迹请求。

### P0-3. 前端：PreviewGrid 每 5s tick 让每个卡片重拉文件清单

**位置**：[PreviewGrid.tsx](src/components/PreviewGrid.tsx#L211-L218) 与 [L98-L128](src/components/PreviewGrid.tsx#L98-L128)
**现状**：`live=true` 时每 5s `setTick`，**每个** `PreviewCard` 的 useEffect 都重新 `fetch(/api/matches/:id/file?runId=...)` 拉文件列表；服务端 `listRunFiles` 递归遍历整个 workdir（同步 `statSync`，[files.ts](src/lib/arena/files.ts#L82-L97)）。
**影响**：3 个 combo + 大产出目录时，每 5s 产生 3 次全目录同步遍历，占用事件循环，且大量请求打到 file 路由。

**建议**：
1. 文件清单拉取从"定时 tick"改为**事件驱动**：仅在 `run.status` 变化（running→completed）、`run-event` 出现 `file_edit`、或用户点击"重载"时刷新。
2. `listRunFiles` 结果按 `(workdir, mtime 摘要)` 做服务端短缓存（类似 detect 的 30s TTL），避免高频全目录遍历。
3. 文件扫描本身也是同步阻塞——改为 `readdirSync` 已不可避免同步，可放到 `AsyncLocalStorage`/微秒级队列里错峰，或用 `fs.promises` 递归（本量级可选，SSR 事件循环友好）。

> 验证：打开对局页 + 预览区，观察 file 路由请求频率从“每 5s×N”降为“按需”。

### P1-1. 执行引擎：每事件同步 appendFileSync 写轨迹

**位置**：[runner.ts](src/lib/arena/runner.ts#L85-L86)
**现状**：`handleEvents` 内对每个事件 `appendFileSync(trajPath, ...)` + `JSON.stringify`。thinking/tool_call/tool_result 高频时每事件一次打开-写入-关闭（appendFileSync 每次 syscall），全程阻塞事件循环。
**建议**：批量缓冲写——内存累积到 N 条或 100ms 定时 flush 一次写盘（进程 crash 最多丢 100ms 事件，可接受）。或改用 `createWriteStream` 管道（注意 waitForDrain 与快进）。
**注意**：`flush`（parser.flush 的 done）与 `close` 前必须强制 flush 缓冲区再广播终态，保证轨迹落盘顺序正确。

> 验证：对局期间 perf stat：flamegraph 中 `appendFileSync` 采样占比应明显下降；同时 stderr/stdout 解析路径不变。

### P1-2. 执行引擎：startup 时同步 cpSync 复制源目录

**位置**：[seed.ts](src/lib/arena/seed.ts#L9-L21)，调用处 [runner.ts](src/lib/arena/runner.ts#L285-L292)
**现状**：每个 run 启动时 `cpSync(sourceDir, dir)` 同步递归复制整个题目项目（排除 .git/node_modules/.arena）。题项目大（几百 MB、几千文件）时，**N 个 combo 并发复制**，每次复制期间事件循环阻塞数秒，页面/SSE 全部停摆。
**建议**：
1. 同步 → 异步：用 `fs.promises.cp`（先 `stat` 即可 removeSync 语义，按目录 filter）包裹复制，避免阻塞主线程。
2. 复制走并发闸门外或单独限流（当前在 `globalLimit` 排队槽里，串行了复制与执行）。
3. 体积优化：整目录复制前对同样源的项目可**只复制差异**（源目录相对稳定时按文件 mtime/hash 增量），或允许 `ARENA_SEED_MAX_*` 跳过超大目录。

> 验证：对 50MB+ 题发一局，network/UI 在 run 启动阶段不再出现秒级无响应；`/api/matches/:id/stream` 心跳不中断。

### P1-3. 轨迹读取全量 readFileSync + JSON.parse

**位置**：[files.ts](src/lib/arena/files.ts#L110-L116)，消费方：trajectory 路由、report 路由、match 页补拉
**现状**：每次调用都对整个 trajectory.jsonl 读盘 + 逐行 JSON.parse。长轨迹（数千行）重复读取 = 重复解析。
**建议**：加进程内 LRU 缓存 `Map<runId, {mtime, events}>`，文件 mtime 未变时直接返回缓存的数组；run 完成后 mtime 稳定，报告/轨迹页/重复轮询都命中缓存。缓存上限 ~20 条 run（防止长时间运行内存膨胀）。写路径（runner appendFileSync）更新缓存或依赖 mtime 失效。

> 验证：完成态对局连续 3 次调用 trajectory 路由，服务端日志不再每次命中磁盘读（文件系统读次数下降）。

### P1-4. SSE 广播无节流、无压背

**位置**：[bus.ts](src/lib/arena/bus.ts#L10-L16) 与 [stream/route.ts](src/app/api/matches/[id]/stream/route.ts#L11-L16)
**现状**：`emit` 同步遍历所有订阅者并 enqueue（含 JSON.stringify 大对象）。慢消费端会拖慢整个事件循环 + 内存堆积。
**建议**：
1. 已按 matchId 过滤（好）。可再加**按 run 订阅**过滤，避免同一对局多 run 事件交叉传播。
2. 广播对象在 enqueue 时才 stringify（保持结构化，route 内序列化）。当前 `emitRunStatus` 里 `toRunDTO` 每 status 变更重建一份，可接受，但事件密集时字符串化是热点。
3. 对高频 `run-event`（thinking/partial message）可 100ms 节流合并（会牺牲部分实时粒度，仅对 message/tool 类型做）。
4. `controller.enqueue` 前检查当前缓冲（`controller.desiredSize`），过大时跳过非关键事件只保 done/status。

> 验证：同时对局开 3 个 run，观察 SSE 消息吞吐与 Node 事件循环延迟（`process.hrtime` 埋点）在节流前后对比。

### P1-5. verify 在 executeTurn 内阻塞收尾

**位置**：[runner.ts](src/lib/arena/runner.ts#L236-L243)
**现状**：run 完成后**同步 await** `verifyFix`（最长 5 分钟，spawn npm test），期间该 run 占用全局并发槽；若短期内多 run 都完成，后续 combo 排队被 verify 拖住。API 层面 `run-status` 终态要等 verify 完才广播（设计上指标先落库，可接受，但并发槽被占是纯损耗）。
**建议**：verify 限流与执行解耦——用独立的 `pLimit(1)` verify 队列（不占 run 并发槽），返回时按 runId 回归 updateRun + 广播一次补充 `run-status`。或保留现状但对 verify 加 `ARENA_VERIFY_CONCURRENCY`。

> 验证：3 combo 对局，三个 run 并行完成进入 verify 后，观察新对局能否立即启动（不再被 verify 阻塞）。

### P2-1. DB：runs 表缺索引（全表扫）

**位置**：[db/index.ts](src/lib/db/index.ts#L19-L23)（DDL 建表无索引）
**现状**：`listRuns`/`getComboStats`/`getDailyTrend` 全部扫 runs 全表并按 `match_id`/`harness` 过滤——个人量级没问题，但跑过几百个 run 后 stats 页 5s 轮询（[stats/page.tsx](src/app/stats/page.tsx#L24-L36)）每次都全表聚合。
**建议**：
1. DDL 追加 `CREATE INDEX IF NOT EXISTS idx_runs_match ON runs(match_id);` 与 `idx_runs_started ON runs(started_at);`（stats 趋势查询）。
2. stats 页改为「对局结束事件后由服务端预热统计 + 内存缓存 30s」，去掉 5s 轮询；或维持轮询但在服务端缓存聚合结果。

> 验证：制造 500 条 runs 后观察 `/api/stats` 响应时间（毫秒级即可）。

### P2-2. 报告构建重复遍历事件数组

**位置**：[report.ts](src/lib/arena/report.ts#L28-L56)、[L88-L106](src/lib/arena/report.ts#L88-L106)
**现状**：`buildMatchReport/HTML` 对每个 run 重复 `filter`/`reverse().find`/`fileEditPaths`（内部又是 filter）遍历同一 events 数组多次。长轨迹下是 O(n)×常数倍，属小优化。
**建议**：单次遍历收集 `{toolCalls, files, messageCount, lastMsg, thinkCount}` 后复用。

### P2-3. 首页 detect 每次刷新起多个 CLI 子进程

**位置**：[registry.ts](src/lib/arena/adapters/registry.ts#L52-L56)
**现状**：30s TTL 缓存已挡住高频重复探测；首次进首页并行 spawn 所有 harness 的 `--version`/`--list-models`。已是合理实现，仅提醒：探测结果并入常见构建/热重载时缓存失效节奏即可，无需改动。

---

## 3. 建议实施顺序

| 阶段 | 事项 | 预期收益 | 复杂度 |
|---|---|---|---|
| 1 | P0-1 事件批量入 state + 轨迹虚拟化/截断 | 长时间对局浏览器不再卡死（最痛） | 中 |
| 2 | P0-2 完成态停止轮询 + 轨迹补拉并行 + 内存缓存（配合 P1-3） | 网络请求量降 90%+ | 低 |
| 3 | P0-3 预览文件清单改为事件驱动 + listRunFiles 短缓存 | 消除每 5s 全目录遍历 | 中 |
| 4 | P1-1 轨迹批量缓冲写盘 | 事件循环清爽，长对局更稳 | 低 |
| 5 | P1-2 seed 复制异步化 | 大题目启动不卡 UI | 中 |
| 6 | P1-3 轨迹读取 LRU 缓存 | 报告/轨迹/轮询响应提升 | 低 |
| 7 | P1-4 SSE 节流与压背 | 高并发对局更稳 | 中 |
| 8 | P1-5 verify 独立限流 | 并发利用率提升 | 低 |
| 9 | P2-1/P2-2 DB 索引 + 报告单次遍历 + stats 缓存 | 规模增长后仍流畅 | 低 |

> 说明：阶段 1-3 是"用户可感知"的瓶颈，优先做；阶段 4-6 属于"稳健性/可持续性"；阶段 7-9 为锦上添花。

---

## 4. 附：观测/验证手段（不新增依赖）

- **浏览器侧**：Chrome DevTools Performance —— 抓首帧交互与持续对局期间主线程长任务；Network 面板统计请求频率与体积。
- **服务端侧**：临时在关键路径埋 `performance.now()` 日志（受 `ARENA_DEBUG` 环境变量控制，与现有 [runner.ts](src/lib/arena/runner.ts#L31) 的调试行风格一致），完成后移除。
- **回归保障**：现有 vitest（`tests/`）覆盖解析/估算/runner 纯逻辑；改动后 `npm run lint` 与 `npm test` 必须保持通过。轨迹语义（事件顺序、flush、done 收尾、指标累加）用 tests/fixtures 固定样本回归，不依赖真实 CLI 登录态。