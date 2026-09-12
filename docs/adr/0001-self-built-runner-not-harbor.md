# 自研轻量执行层，不复用 Harbor / Docker

产品定位于个人本地工具（Windows）、自由 prompt 任务、无需题库判分，而 Harbor 的核心价值（Docker 统一容器隔离、Terminal-Bench 风格题库验证）在本场景均用不上，且其强依赖 Docker（Windows 上需 Docker Desktop + WSL2）。故决定自研轻量 runner：spawn 子进程 + 解析各 harness 的 stream-json 事件流。执行层做成接口抽象，将来若需要环境公平性可再加 Docker 实现。

## Considered Options

- 裸跑 + 自研轻量 runner（选定）
- Docker 统一容器 + 自研编排
- 复用 Harbor 作为执行引擎

## Consequences

各 harness 沙箱策略差异（Codex 自带沙箱、Claude Code 直连文件系统）未做归一——对个人选型工具而言，「它在我机器上的真实表现」包含这些差异，属可接受偏差。
