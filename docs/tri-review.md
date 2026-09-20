# 可靠性 / 评测公平性 / 测试盲区 评审报告

> 生成时间：2026-09-20 · 分析范围：`src/` 全部代码、`tests/`、`docs/adr/`、题库目录
> 与 `performance-review.md`（性能）和 `architecture-review.md`（模块设计）互补，本文覆盖三个维度：**故障恢复**、**评测公平性**、**测试盲区**。
> 所有结论均带代码位置与验证方法；实测部分为当日在本机跑出的结果。

---

## 〇、总体判断

这个项目的"测量仪器"属性决定了它的质量重心：一台并排测量多个 harness × 模型组合的本地基准仪。因此三个维度的相对权重是：**公平性 > 故障恢复 > 测试盲区**——仪器准不准是它的核心价值，坏了能不能自愈决定可用性，防护网决定改起来安不安全。

实测结论先行：

- 测试套件当前 **23 文件 / 97 用例全绿（4.28s）**，覆盖远好于第一印象——runner、verify、看门狗都有回归测试，`--passWithNoTests` 的风险实际未兑现；
- 但发现 **1 个 L0 数据正确性 bug（长行丢行，已实验复现）**、**1 个 L1 反作弊静默失效（题库未独立成 git 仓库）**、**1 个 L1 无恢复路径（服务重启后 running 状态永久悬挂）**；
- 公平性方面，成本/token 口径统一做得认真（pricing.ts 的注释解释了为什么必须自算），但存在几个系统性的口径偏差未被 UI 标注。

---

## 一、故障恢复（Resilience）

> 问题定义：宿主环境出错（重启、崩溃、断电、CLI 挂起）后，系统处于什么状态？能否自愈？

### R-1. 服务重启后 `running` 状态永久悬挂，无任何恢复路径【L1】

**位置**：[runner.ts:38-43](src/lib/arena/runner.ts#L38-L43)、[db/index.ts](src/lib/db/index.ts)、全仓库无 `instrumentation.ts`

**现状**：活跃子进程登记挂 `globalThis`（[runner.ts:42](src/lib/arena/runner.ts#L42)），代码注释明确说这是为了扛 dev 热重载——同一进程内模块重载时登记不失联。但这条护城河只覆盖"模块重载"，不覆盖"进程死亡"：

- dev server 崩溃 / 手动 Ctrl+C / 机器重启后，DB 里所有 `status="running"` 的 run **永久保持 running**；
- 这些 run 的对局状态也停在 `running`，History 页永远显示"进行中"；
- UI 停止按钮经 stop 路由 → `stopRun` → `activeChildren.get(runId)` 查不到进程，返回 409「该 agent 不在运行中」——**这个报错文案是误导性的**：DB 与 UI 明明显示 running，却说"不在运行中"，用户无法理解；且没有任何手段把这具尸体标记为 failed；
- `runMatch`/`rerunCombos` 因存在 running run 而拒绝重跑（[runner.ts:363](src/lib/arena/runner.ts#L363)），死锁了整个对局。

**建议**：
1. 新增 `src/instrumentation.ts` 导出 `register()`（本 Next 版本支持，见 `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`；文件放 `src/` 下与 `app/` 同级）。启动时执行一次 reconcile：`UPDATE runs SET status='failed', error='服务重启，运行中断' WHERE status IN ('running','pending')`，对局状态同样收敛（有中断记录的对局标 `partial`）。SQLite 单行语句，个人工具量级无性能顾虑。
2. stop 路由分支处理失联 run：DB 显示 running 但 `stopRun` 返回 false 时，直接落库 `failed`（error=「进程已失联（服务可能已重启），已强制标记失败」），给用户一个能收拾残局的出口。

**验证**：开一局长跑对局 → Ctrl+C 杀 dev server → 重启 → History 页应看到该局变 partial、run 变 failed 且 error 说明原因；点重跑应放行。

### R-2. 轨迹文件 all-or-nothing 解析 vs 注释承诺的"逐行兜底"【L3】

**位置**：[files.ts:124-141](src/lib/arena/files.ts#L124-L141)

**现状**：`readTrajectory` 的注释写着"单行损坏按尽力而为语义兜底空数组"，实现却是 `JSON.parse` 在任何一行失败时整个 catch 返回 `[]`——**一行的损坏让整条轨迹消失**，而不是丢弃该行保留其余。半行写入（进程中途被杀、磁盘满）是断电场景下的常态，这个组合行为最差：最需要回放的时候（崩溃后取证）恰好一条都读不出来。

**建议**：改为逐行 try/catch：损坏行替换为 `{kind:"warn", text:"[trajectory] 损坏行已跳过"}` 事件，其余照常。报告页与轨迹 UI 已有 warn 事件的展示位。

**验证**：手工构造一份"若干好行 + 一行坏 JSON + 若干好行"的 trajectory.jsonl，`GET /api/matches/:id/trajectory` 应返回坏行外的全部事件。

### R-3. `appendFileSync` 落盘与 `writeTraj` 无冲刷保证【L3】

**位置**：[runner.ts:86](src/lib/arena/runner.ts#L86)

`appendFileSync` 一次调用原子性足够（单次 write 系统调用，SQLite WAL 模式下 DB 一致性也无虞），但进程被强杀（taskkill /F）时最后的执行痕迹只到上一个事件——对于"为什么被停"的取证够用，但 R-2 的逐行容错是这个场景的必要补充（半行是真实可能存在的）。与 R-2 合并处理即可，不单列工作量。

### R-4. 孤儿 workdir 与"有 DB 无目录"的反向孤儿【L3】

**位置**：[paths.ts](src/lib/arena/paths.ts)、[db/index.ts:146-165](src/lib/db/index.ts#L146-L165)、[file/route.ts:13-20](src/app/api/matches/[id]/file/route.ts#L13-L20)

workdir 在 `os.tmpdir()/model-agent-arena/runs`（默认值），删除对局时同步清理磁盘（[db/index.ts:158-163](src/lib/db/index.ts#L158-L163)），running 时禁止删除——设计闭环。但两个孤儿来源没覆盖：
- R-1 的尸体对局：DB 没删、目录还在，永远占着；
- workdir 在 tmp 目录，系统清理策略或手动清 tmp 会产生"有 DB 无目录"的反向孤儿。此时 `listRunFiles` 的 `readdirSync` 对不存在目录直接 throw，被路由的 try/catch 捕获后返回 **500「文件读取失败」**——历史对局的文件页整个不可用，而不是显示空产物。

**建议**：`listRunFiles` 的 walk 外层对 ENOENT 返回空列表（目录不存在 = 没有产出文件，语义上说得通）；报告路由的 `readTrajectory` 已有 catch 兜底空数组，无需改。R-1 reconcile 落库时顺带不动磁盘（保守），孤儿目录仍靠删对局清理——个人工具可接受。

**验证**：手工把某 completed run 的 workdir 目录改名，`GET /api/matches/:id/file?runId=...` 应返回空文件列表而不是 500。

---

## 二、评测公平性（Fairness）

> 问题定义：这台仪器本身的系统误差有多大？跨组合对比时哪些结论是"仪器造成的"，哪些是真实的模型/harness 差异？

### F-1. 内置题库未独立成 git 仓库，反作弊恢复从不生效【L1】

**位置**：[verify.ts:47](src/lib/arena/verify.ts#L47)、题库目录 `questions/`

**现状**：反作弊设计很认真——验证前从题库 git 仓库恢复原始测试文件，防止 agent 改测试"自证通过"，还有专门的回归测试（[verify.test.ts:51-69](tests/arena/verify.test.ts#L51-L69)）。但门条件是 `existsSync(path.join(opts.sourceDir, ".git"))`（[verify.ts:47](src/lib/arena/verify.ts#L47)），而 **`questions/` 下的内置题库没有嵌套 `.git`**（实测 `ls questions/*/.git` 均不存在）——反作弊对内置题目**静默失效**，verify 直接跳过恢复，agent 改过的测试原样参与判定。

而修复成本比表面看起来低得多：题目目录嵌在 arena 仓库内部，实测在 `questions/js-bugs/debounce/` 下执行 `git ls-files`，能正确返回且**仅返回**该题目的 4 个文件（package.json、question.json、src/debounce.js、test/debounce.test.js）——`git ls-files` 以 cwd 为作用域，不会把父仓库其他文件卷进来。门条件挡住的是一个本可工作的路径。（用户题库在 `.arena/questions`，被 gitignore，`git ls-files` 自然返回空，跳过恢复，行为与现状一致。）

**建议**（推荐 1）：
1. **直接放宽门条件**（一行）：把 `existsSync(.git)` 判断换成"尝试 `git ls-files` 且返回非空"——现有实现里 `git ls-files` 失败/空返回时本就有跳过语义（[verify.ts:21-24](src/lib/arena/verify.ts#L21-L24)），把 `.git` 门去掉后非 git 目录会走同一跳过路径，无需额外分支。内置题目立即获得反作弊保护。
2. **题库独立 git 化**：`questions/` 作为独立仓库（`git init` + 内部 `.git`），仓库根 `.gitignore` 加 `questions/.git`。语义更严格（题目文件的"原始版本"由题目仓库自己的 HEAD 定义，不受 arena 仓库未提交改动影响），但维护成本高一点——改题目要记得在两个仓库各提交一次。
3. **快照机制**：seed 时把测试相关文件备份到 `workdir/.arena/original-tests/`，verify 前从那里恢复。不依赖题库形态，但多一套备份逻辑。

**验证**：用 debounce 题开一局，agent（或手工）把 workdir 里的 `test/debounce.test.js` 改成 `process.exit(0)`，完成后 verify 应报 failed（原始测试被恢复，作弊无效）；verify.log 应包含"已从题库恢复"。

### F-2. token/成本口径的三个系统性偏差，UI 未标注【L2】

**位置**：[pricing.ts:39-45](src/lib/arena/pricing.ts#L39-L45)、各 adapter 的 usage 提取、[ComparisonTable.tsx:64-81](src/components/ComparisonTable.tsx#L64-L81)

成本统一自算（CLI 自报不可信，pricing.ts 头注释有详细交代）方向正确，但三个口径偏差会让"跨组合对比表"里的数字**看起来可比而实际不可比**：

1. **cacheRead 计价口径分裂**：`computeCostUsd` 把 `cacheRead` 按输入档计价（`input + cacheRead`）——但缓存读取的公允价格通常是输入价的 10%（Anthropic/OpenAI 均如此，方舟多数模型亦然）。当前实现对重度缓存命中的组合成本**虚高约 10 倍**（缓存部分），而缓存命中本身又依赖 harness 的 prompt 缓存实现——这会把"harness 缓存策略差异"直接放大成"成本差异"。
2. **opencode 的 usage 缺 cacheRead 维度**：opencode 的 step_finish 按步累加（[opencode.ts:38-79](src/lib/arena/adapters/opencode.ts#L38-L79)），口径是"本次调用"，而 claude-family 的 result 行 usage 是"整轮累计"。一个按步求和、一个取终值，数学上等价；但 opencode 的 tokens 里没有 cacheRead 语义（`tokens.cache?.read` 有字段但方舟 provider 恒报 0，meta.ts 注释自证），等于 opencode 组合的成本天然不含缓存维度。
3. **pi 的 usage 来自 message_update 的"最后一条"**（[pi.ts:65-80](src/lib/arena/adapters/pi.ts#L65-L80)）：取的是累计值的最新一条，注释说明 agent_end 可能多次。如果最后一次 message_update 之后 agent 内部还有调用但没再发 message_update，用量会被低估。qoder/trae 有 total_cost_usd 但被有意忽略（统一自算），合理。

这三个偏差叠加的净效果：**costUsd 列在"重度缓存 harness × 未报缓存 harness"对比时，误差可达数倍**。对个人工具不算 bug（定价表本身也明说"未收录返回 null 不编造"），但对比表的 cost 列没有口径标注，会直接误导"哪个组合更便宜"的结论。

**建议**：短期在 ComparisonTable 的 cost 列头加 tooltip（"按输入档计价，缓存读取未按优惠价折算；不同 harness 缓存命中率不同，跨 harness 成本对比仅供参考"）；中期在 pricing.ts 加缓存档位（`cachePrice = inPrice * 0.1`），对报告有 cacheRead 的组合按优惠价计。

**验证**：用 debounce 题各跑 claude-code（有 cacheRead）与 opencode（无）组合，对比实测成本与方舟控制台账单，偏差应从数倍收敛到 ±20% 内。

### F-3. `PREVIEW_PROMPT_HINT` 追加给所有 harness，但预览能力只有部分 harness 有意义【L3】

**位置**：[files.ts:12-13](src/lib/arena/files.ts#L12-L13)、[runner.ts:296](src/lib/arena/runner.ts#L296)

每个组合的 prompt 都追加了同一段"起本地服务并把 URL 写进最终回复"的约定。对算法题/bug 修复题（js-bugs、algorithms 题库），这段提示是无信息的噪声，会轻微扰动模型行为（多一次工具调用尝试、多一段回复文本），而这些扰动**计入 tokensIn/Out 与成本**——又是仪器对被测物的影响。且题库的 question.json prompt 里已经写了"修完运行 npm test"这类题目特定指令，两段指令叠加。

**建议**：按题库特征决定是否追加 hint（bank.json 加 `previewHint: false` 字段，js-bugs/algorithms 默认关）；或至少把 hint 从 prompt 里挪到"系统约定"层不进 token 计量（后者实现重，不推荐）。

**验证**：同一题开"带 hint/不带 hint"各 3 局，对比 tokensIn 中位数与工具调用数，若差异 >10% 则值得关。

### F-4. 均匀超时对慢模型的截断偏差【L3】

**位置**：[runner.ts:21](src/lib/arena/runner.ts#L21)

15 分钟统一超时对所有组合一视同仁，形式公平；但慢模型/重度思考模型在超时边缘的产出会被记为 `timeout`，而"timeout"混合了"模型太慢"和"任务本身需要这么久"两种归因。L2 指标（ADR-0003）以完成率/耗时为主，超时占比是隐藏的第三变量。

**建议**：不改动行为，只在 stats 页把 timeout 率单列（现在 completed/total 隐含了它），对比表也标注哪些 run 是 timeout——避免把"慢"误读成"完成不了"。

---

## 三、测试盲区（Test Blind Spots）

> 问题定义：现有 97 个测试挡住了什么？没挡住什么？改哪里的风险最高？

**先修正一处此前的口误**：初盘只看到截断的文件列表，曾说"runner/bus 零测试"——实际 `tests/arena/` 下有 runner.test（6 用例）、runner-idle.test（2 用例）、verify.test（5 用例）、seed.test 等，**核心执行链路有回归测试，且当日实测 23 文件/97 用例全绿（4.28s）**。真正的问题不是"没有测试"，是以下几个结构性盲区。

### T-1. fixture 全是短行，跨 chunk 长行解析是真实盲区【L0】

**位置**：[runner.ts:179-196](src/lib/arena/runner.ts#L179-L196)、[tests/fixtures/*.jsonl](tests/fixtures/)

**这是本次评审发现的最严重问题，已实验复现。** runner 把 stdout 数据流按 `\n` 切分后逐行喂给 parser，`child.stdout.on("data", chunk => chunk.split("\n").forEach(handleLine))`。但 Node 流的 data 事件按任意边界切分——**一条 JSON 行跨越两个 chunk 时，两半都会 JSON.parse 失败被静默丢弃**（claude-family parser 的 `catch { return [] }`，[claude-family.ts:38](src/lib/arena/adapters/claude-family.ts#L38)；codex 同样）。

实验复现（与 runner 相同逻辑，200KB 单行 message）：

```
parsed=1 failed=4
```

5 行 JSON（1 条 200KB 长行 + 其他）用 runner 的逐 chunk 切分逻辑处理，**4 行丢失**。长 tool_result（大文件读取、目录列表、长 command 输出——恰好是 agent 干活时最常见的输出形态）在真实对局中极易超过 64KB 的默认 highWaterMark，**当前所有 harness 的真实对局里都可能在静默丢事件**。fixture 全是几 KB 短行，测试从未覆盖这个场景。丢事件的后果链：轨迹不完整 → 报告的 toolCalls/fileEdits 统计失真 → 预览嗅探漏检（message 事件丢了就丢 URL）→ 指标累加错。

**建议**：runner 的行缓冲只需 10 行——模块级 `let leftover = "";`，`data` 事件里 `leftover += chunk; const lines = leftover.split("\n"); leftover = lines.pop() ?? "";`，close 时 `handleLine(leftover)`。同时给测试加一个跨 chunk 用例：fake 脚本单次 write 一条 200KB 长行 + 正常行，断言事件数不丢。

**验证**：`node /tmp/chunk-test.mjs` 实验脚本已复现（修复前后对跑）；修好后用真 CLI 跑一局读大目录的对局，轨迹里 command 事件应完整。

### T-2. fake 命令注入的 fakeLineEvents 与真实 parser 双轨，假阴性风险【L2】

**位置**：[runner.ts:267-274](src/lib/arena/runner.ts#L267-L274)、[runner.test.ts](tests/arena/runner.test.ts)

runner 测试用 `ARENA_FAKE_CMD` 注入替身脚本，输出走 `fakeLineEvents`（直接按 ArenaEvent JSON 直通）。这套机制测**runner 状态机**（落库、指标累加、看门狗、停止语义）没问题；但它绕过了真实 adapter 的 parser——**adapter 测试测 parser 逻辑、runner 测试测状态机，两者拼起来才是完整链路，但没有一个测试同时穿过"真实 parser + 真实 runner"**。T-1 的长行丢行恰好就漏在这个缝里：fixture 测试短行全过，runner 测试 fake 事件全过，拼接处坏掉。

**建议**：加一个"半集成"用例：fake 脚本输出 claude-family 格式的原始 JSONL（不是 ArenaEvent 直通），runner 走真实 parser 路径跑完整对局，断言落库指标与轨迹。一个用例即可补上这个缝。

**验证**：该用例在 T-1 修复前应失败（长行丢失导致断言不过），修复后转绿——正好构成 T-1 的回归测试。

### T-3. `--passWithNoTests` 掩盖配置整体失效【L2】

**位置**: [package.json:10](package.json#L10)

`vitest run --passWithNoTests` 意味着 include glob 写错、或 vitest 大版本升级改变了 glob 语义时，`npm test` 依然绿。当前 97 个用例跑得很好，但这个开关让"全绿"的含义退化成"至少没挂"而不是"确实在测"。

**建议**：去掉 `--passWithNoTests`，在 CI/提交前脚本里显式断言测试数量下限（如 `vitest run 2>&1 | grep -c "passed"` ≥ 90）；或至少在 vitest.config.ts 里加注释说明为什么允许空跑（如果确有历史原因）。

**验证**：临时把 include 改成 `tests/**/*.nope.ts` 跑 npm test，当前会绿着通过——去掉开关后应红。

### T-4. 无 CI，全靠本地自觉【L3】

**位置**：仓库根无 `.github/workflows/`

个人工具不配 CI 合理，但提交规范（AGENTS.md 第 9 条）要求"提交前 lint 与 test 必须通过"，这条纪律只存在于文档。Windows 本地跑（当前 4.28s）成本极低，建议 package.json 加 `precommit` 级别的提示或 Git hook（不引 husky 之类依赖，一个简单的 `.git/hooks/pre-commit` 软链脚本即可，或者干脆接受现状——见仁见智）。

### T-5. 真实输出的快照漂移检测缺失【L3】

**位置**：[tests/fixtures/*.jsonl](tests/fixtures/)

fixture 是 Task 0 实测采样，注释里也诚实标注了 qoder 的样本采于额度耗尽时、tool_use/tool_result 未采到（[qoder.ts:10-11](src/lib/arena/adapters/qoder.ts#L10-L11)）。但没有机制提醒"这个 fixture 对应的 CLI 版本已经落后"。CLI 升级后事件格式变化（如 claude-code stream-json 加字段、改名）时，旧 fixture 依然全绿，而真实对局已经解析异常。

**建议**：detect 时已有的 CLI 版本探测（model-probe.ts）顺带把版本号存进 fixture 元数据（如 `fixtures/claude-code.jsonl.meta`），adapter 测试断言"探测到的版本与 fixture 采样版本主版本一致"——不一致时 skip 并 warn（不 fail，避免 CLI 升级即红）。或更轻量：报告文档里维护一张"fixture 采样版本表"，人工每季度对一次。

---

## 四、维度交叉：三个视角拼出的完整图景

| # | 发现 | 维度 | 级别 | 修复成本 |
|---|---|---|---|---|
| T-1 | 跨 chunk 长行静默丢弃（已实验复现） | 测试盲区 × 正确性 | **L0** | ~10 行 + 1 用例 |
| F-1 | 内置题库反作弊静默失效 | 公平性 | **L1** | 一行（放宽门条件） |
| R-1 | 重启后 running 悬挂 + 误导性 409 + 对局死锁 | 故障恢复 | **L1** | instrumentation.ts ~20 行 |
| F-2 | cost 口径三分裂 + UI 无标注 | 公平性 | L2 | tooltip 快 / 计价重构中 |
| T-2 | 真实 parser × 真实 runner 的集成缝 | 测试盲区 | L2 | 1 用例 |
| T-3 | `--passWithNoTests` 掩盖空跑 | 测试盲区 | L2 | 1 行 |
| R-2 | 轨迹整文件 all-or-nothing 解析 | 故障恢复 | L3 | ~5 行 |
| R-4 | workdir 反向孤儿 → 文件页 500 | 故障恢复 | L3 | try/catch |
| F-3 | preview hint 对算法题是计量噪声 | 公平性 | L3 | bank.json 加字段 |
| F-4 | 超时混合归因，stats 未单列 | 公平性 | L3 | stats 页小改 |
| T-4 | 无 CI | 测试盲区 | L3 | 见仁见智 |
| T-5 | fixture 版本漂移无检测 | 测试盲区 | L3 | 元数据 + skip 逻辑 |

三个维度的发现互相咬合：**T-1（长行丢失）正是通过"公平性视角检查指标口径"和"测试盲区视角检查 fixture 形态"交叉发现的**——fixture 都短、真实输出有长行、runner 恰好没缓冲，三个条件同时成立才成 bug。这印证了评审多视角交叉的价值：单看"易用性/安全性/正确性"的分维度清单，这类缝隙处的问题最容易漏。

**建议的修复顺序**：T-1（数据正确性，成本最低，行缓冲 + 半集成用例一个提交闭环）→ F-1（一行放宽门条件，立即恢复反作弊）→ R-1（解除重启死锁）→ F-2 的 tooltip 标注 → 其余按表。

---

## 五、修复记录（2026-09-20）

上表前 7 项已修复，全量验证：**24 文件 / 108 用例全绿（4.8s），eslint 零告警**（较修复前 +1 文件 +11 用例）。

| # | 修复内容 | 落点 |
|---|---|---|
| T-1 ✅ | runner 增加 stdout/stderr 行缓冲（`splitLines` 保留跨 chunk 残行），close 时冲刷无换行尾行；新增跨 chunk 回归用例（200KB 单行） | [runner.ts](../src/lib/arena/runner.ts)、runner.test.ts |
| T-2 ✅ | PATH shim 半集成用例：不设 fake 环境变量，runner 经真实 `buildCommand`（`claude` 实名 CLI）+ 真实 claude-family parser 全链路，断言 usage 从 result 行提取落库 | runner.test.ts |
| F-1 ✅ | verify 放宽 `.git` 门条件：非 git 目录经 `git ls-files` 空/失败路径跳过恢复；内置题库（嵌父仓库）立即获得反作弊；新增父仓库场景与用户题库（无 git）场景用例 | [verify.ts](../src/lib/arena/verify.ts)、verify.test.ts |
| R-1 ✅ | 新增 `reconcileStaleRuns()`（启动时把 running/pending 尸体收敛为 failed，对局按全量 runs 收敛 partial，幂等零写入）+ `src/instrumentation.ts` 的 `register()` 钩子调用；stop 路由对失联 run 直接标记 failed 并返回明确文案，替代误导性 409；3 个 DB 测试 | [db/index.ts](../src/lib/db/index.ts)、[instrumentation.ts](../src/instrumentation.ts)、[stop/route.ts](../src/app/api/matches/[id]/stop/route.ts)、reconcile.test.ts |
| R-2 ✅ | `readTrajectory` 逐行容错：损坏行跳过并插入 warn 标记，其余事件照常 | [files.ts](../src/lib/arena/files.ts)、files.test.ts |
| R-4 ✅ | `listRunFiles` 目录不存在返回空列表、子树消失跳过（历史 run 的文件页显示空产物而非 500） | files.ts、files.test.ts |
| F-2（部分）✅ | ComparisonTable 成本列头加口径 tooltip（缓存计价 + harness 缓存上报差异的对比警示）。**计价重构（缓存优惠档）未做**，属中期项 | [ComparisonTable.tsx](../src/components/ComparisonTable.tsx) |
| T-3 ✅ | 去掉 `--passWithNoTests`，`npm test` 现在要求测试确实存在并执行 | [package.json](../package.json) |

修复过程中发现并修正的两个实施细节（评审报告推断的修正）：
1. **半集成用例的 shim 文件名**：claude-code adapter 的 `buildCommand` file 字段是 CLI 实名 `claude`（非 harness id `claude-code`），shim 须以此为名前置 PATH；首个用例因此调到了本机真实 CLI（轨迹里出现真实模型报错）才定位到。
2. **F-1 的推断已在实验中证实**：`git ls-files` 以 cwd 为作用域，父仓库场景用例同时验证了"恢复只覆盖题目目录内文件、arena 自己的 tests/ 不会被卷入"。

未修复项（保留为后续任务）：F-2 计价重构（缓存优惠档）、F-3 preview hint 计量噪声、F-4 stats timeout 率单列、T-4 CI、T-5 fixture 版本漂移检测。

---

## 六、修复记录·第二轮（2026-09-20）

上节遗留的 5 项全部完成，全量验证：**25 文件 / 113 用例全绿，eslint 零告警，`tsc --noEmit` 干净，`next build` 成功**。

| # | 修复内容 | 落点 |
|---|---|---|
| F-2 ✅ | pricing 加缓存优惠档：cacheRead 按输入价 10% 计（`CACHE_DISCOUNT`，主流供应商缓存价通用折扣），修复重度缓存组合成本虚高约 10 倍；pricing/estimator 测试同步更新；ComparisonTable tooltip 文案改为新口径 | [pricing.ts](../src/lib/arena/pricing.ts)、pricing.test.ts、[ComparisonTable.tsx](../src/components/ComparisonTable.tsx) |
| F-3 ✅ | preview hint 计量噪声开关：`previewHintEnabled(questionDir)` 读 bank.json 的 `previewHint` 字段（缺省启用、损坏宽松处理），runner 首轮/续聊统一按其决定是否追加 `PREVIEW_PROMPT_HINT`；内置 algorithms / js-bugs 两个题库声明 `previewHint: false`（html-games 保留启用——浏览器游戏正是预览目标场景）；4 个新测试 | [questions.ts](../src/lib/arena/questions.ts)、[runner.ts](../src/lib/arena/runner.ts)、questions/bank.json、questions.test.ts |
| F-4 ✅ | stats 超时率单列：`getComboStats`/`getHarnessStats` 聚合加 `timeouts` 计数（超时 ≠ 失败，避免把"模型太慢"误读成"完成不了"）；stats 页 Harness 对比行显示「超时 N」（有才显示）、组合表新增超时列（>0 琥珀色高亮）；新测试断言 3 run（2 timeout + 1 completed）的计数 | [db/index.ts](../src/lib/db/index.ts)、[stats/page.tsx](../src/app/stats/page.tsx)、stats.test.ts |
| T-5 ✅ | fixture 采样版本表：登记 7 个 harness 的 CLI 实名/采样版本/覆盖事件/已知缺口（qoder 的 tool_use 样本缺失等），含重采流程约定 | [tests/fixtures/README.md](../tests/fixtures/README.md) |
| T-4 ✅ | 最小 GitHub Actions CI：push/PR 触发，Node 20/22 矩阵，`npm ci → lint → test` | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |

**build 排障记录**（第二轮引入并当场解决的两个问题，留档供后续参考）：

1. **instrumentation.ts 不能直接引 `@/lib/db`**：instrumentation 在 Node 与 Edge 两个运行时都会打包，better-sqlite3（原生模块，`serverExternalPackages` 只对 App Route 打包图生效）进入 edge 图后 `binding.js` 的动态 require 报 Module not found。解法按捆绑文档的官方模式：`instrumentation.ts` 以 `process.env.NEXT_RUNTIME === "node"` 分流，node 逻辑拆到 `instrumentation.node.ts` 动态 import，edge 为 no-op。这也解释了为什么 R-1 的收敛逻辑不能图省事写在别处（如 layout）——启动钩子是唯一在服务就绪前执行的约定位置。
2. **files.ts 的 TS 类型收窄**：`try` 外声明、`try` 内赋值 `readdirSync(d, { withFileTypes: true })` 的结果时，`ReturnType<typeof readdirSync>` 会取到错误的重载（Dirent<Buffer>），显式标注 `Dirent[]` 解决。

修复后 R-1 的验证路径更新：重启 dev server 前先确认有 running 尸体 → 重启后启动日志应出现 `[arena] 启动收敛：N 个中断的 run 已标记为 failed` → History 页该对局变 partial → 重跑按钮放行。

**至此评审报告 12 项发现全部闭环。** 后续可考虑的非阻塞增强：F-2 的 per-model 精确缓存价（当前统一 10% 折扣档已够量级参考）、T-5 的版本表自动化检测（当前人工对照）。

### R-1 端到端验证与修正（2026-09-20 补）

第二轮收尾时用临时 DB（`ARENA_DB` 指向 Temp 下的种子库，内含 1 个 running 尸体 run + running 对局）真实启动 `next start` 做了一次 e2e 验证，**发现并修正了 instrumentation 接线的两个问题**：

1. **`NEXT_RUNTIME` 的 Node 侧取值是 `'nodejs'` 而不是 `'node'`**（捆绑文档 instrumentation.md L76 明示）。首版写 `'node'` 导致条件永假，Turbopack 把 `register` 优化成空函数——build 不报错、测试不覆盖、运行时静默失效，属于最阴险的一类错误，只有 e2e 才能暴露。
2. **验证手段**：检查 `.next/server/chunks/` 里 instrumentation chunk 是否包含 `启动收敛` 字符串与 `nodejs` 守卫（bundle 级断言），再以种子库重启 `next start`——启动日志出现 `[arena] 启动收敛：1 个中断的 run 已标记为 failed`，DB 复查 run → `failed`（error=服务重启，运行中断…）、match → `partial`，链路闭环。

R-1 最终验证状态：**单测（reconcileStaleRuns 3 用例）+ bundle 断言 + 真实启动 e2e 三层均通过**。
