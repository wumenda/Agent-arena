# 只适配开源且可无头驱动的 harness

用户点名的 Trae IDE 与 zcode 均为闭源且无公开无人值守接口（TRAE CLI 仅企业版 OAuth 登录、zcode 无 CLI/API），无法程序化驱动，故矩阵明确排除二者：字节以开源的 trae-agent（bytedance/trae-agent）替代，智谱以「GLM 模型 × 各开源 harness」替代。矩阵准入标准：开源 + 官方支持 headless 模式 + 结构化事件输出。
