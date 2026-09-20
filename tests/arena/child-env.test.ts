import { describe, it, expect } from "vitest";
import { childEnv } from "@/lib/arena/runner";

describe("childEnv（agent 子进程环境变量：密钥剥离）", () => {
  const base: Record<string, string | undefined> = {
    NODE_ENV: "test",
    PATH: "/usr/bin",
    HOME: "/home/u",
    ARK_BASE_URL: "https://ark.example",
    ARK_API_KEY: "sk-ark-secret",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    MY_APP_TOKEN: "t0ken",
    DB_PASSWORD: "pw",
    npm_config_registry: "https://registry.npmjs.org",
  };

  it("剥离已知密钥名（白名单）", () => {
    const env = childEnv(base);
    expect(env.ARK_API_KEY).toBeUndefined();
    expect(env.ARK_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("按命名模式剥离（_KEY/_TOKEN/_PASSWORD 等后缀，不区分大小写）", () => {
    const env = childEnv(base);
    expect(env.MY_APP_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
  });

  it("保留非敏感变量（PATH/HOME/npm 配置等）", () => {
    const env = childEnv(base);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.npm_config_registry).toBe("https://registry.npmjs.org");
  });

  it("空值跳过、undefined 环境保留透传语义", () => {
    const env = childEnv({ FOO: undefined, BAR: "1", SECRET_KEY: "" });
    expect(env.FOO).toBeUndefined();
    expect(env.BAR).toBe("1");
    expect(env.SECRET_KEY).toBeUndefined(); // 空字符串也属于敏感键，剥离
  });
});
