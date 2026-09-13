import { describe, expect, it } from "vitest";
import {
  parseClaudeSettingsModels,
  parseCodebuddyHelp,
  parseListOutput,
  parseTomlModels,
  uniq,
} from "@/lib/arena/adapters/model-probe";

describe("model-probe 纯解析器", () => {
  it("parseListOutput：按行解析、去重、去空", () => {
    expect(parseListOutput("opencode/big-pickle\r\nark/glm-5.2\nark/glm-5.2\n\n")).toEqual([
      "opencode/big-pickle",
      "ark/glm-5.2",
    ]);
    expect(parseListOutput("")).toEqual([]);
  });

  it("parseTomlModels：只取 key 恰为 model 的值，容忍 profiles 与空白", () => {
    const toml = [
      'model_provider = "custom"', // 不得误匹配
      'model_reasoning_effort = "medium"', // 不得误匹配
      'model = "gpt-6-astra"',
      "",
      "[profiles.ark]",
      '  model = "glm-5.3-flash"',
      'model_tier = "x"', // 不得误匹配
    ].join("\n");
    expect(parseTomlModels(toml)).toEqual(["gpt-6-astra", "glm-5.3-flash"]);
    expect(parseTomlModels("no models here")).toEqual([]);
  });

  it("parseCodebuddyHelp：提取 Currently supported 括号列表", () => {
    const help = "  --model <model>  Model for the current session. Currently supported: (hy4-preview-f, glm-5.3, kimi-k3-1)";
    expect(parseCodebuddyHelp(help)).toEqual(["hy4-preview-f", "glm-5.3", "kimi-k3-1"]);
    expect(parseCodebuddyHelp("no list")).toEqual([]);
  });

  it("parseClaudeSettingsModels：env 映射置前、别名恒在、容错坏 JSON", () => {
    const settings = JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "secret-should-not-appear",
        ANTHROPIC_MODEL: "glm-5.3-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flash",
      },
    });
    expect(parseClaudeSettingsModels(settings)).toEqual(["glm-5.3-flash", "sonnet", "opus", "haiku"]);
    expect(parseClaudeSettingsModels("not json")).toEqual(["sonnet", "opus", "haiku"]);
  });

  it("uniq：String 化、trim、去空、保序", () => {
    expect(uniq([" a ", "a", "", 1, null, "b"])).toEqual(["a", "1", "b"]);
  });
});
