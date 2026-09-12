# 模型-Agent竞技场（Model-Agent Arena）

让用户用同一条自由输入的提示词，并排对比多个「harness × 模型」组合的执行过程与结果，辅助模型/harness 选型的个人本地工具。

## Language

**Harness**:
驱动模型完成编程任务的 agent 框架（Claude Code、Codex CLI、OpenCode 等）。只包含可无头驱动的开源 harness。
_Avoid_: IDE、客户端

**组合（Combo）**:
一个 harness 与一个模型的配对，是对比的基本单位。
_Avoid_: 配置项、pair

**对局（Match）**:
用户一次提交所产生的完整实验：同一条提示词 × 一组组合。
_Avoid_: 会话、实验

**运行（Run）**:
对局中单个组合的一次执行，产出轨迹与指标。
_Avoid_: 任务、job

**轨迹（Trajectory）**:
一次 Run 期间 harness 输出的完整事件流：工具调用、文件编辑、思考过程。
_Avoid_: 日志、trace

**指标（Metrics）**:
Run 结束时自动采集的客观量化数据：耗时、token 用量、成本。
_Avoid_: 评分

**一句话配置**:
用户用一句自然语言描述想要的对比，由 LLM（GLM-5.3-Flash via 火山方舟，见 `.agents/rules/apikey.md`）解析为可编辑的实验配置，回显确认后才执行。
_Avoid_: 自动配置（暗含未确认直接执行）
