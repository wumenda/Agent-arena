import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeResolveFile, listRunFiles, readRunFile, extractPreviewUrl, savePreviewUrl, readPreviewUrl, previewUrlPort, clearPreviewUrl, readTrajectory, invalidateTrajectoryCache, PREVIEW_URL_FILE } from "@/lib/arena/files";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "arena-files-")); });

describe("safeResolveFile", () => {
  it("resolves a relative path inside workdir", () => {
    expect(safeResolveFile(dir, "hello.txt")).toBe(path.resolve(dir, "hello.txt"));
  });
  it("resolves nested paths", () => {
    expect(safeResolveFile(dir, "src/main.ts")).toBe(path.resolve(dir, "src/main.ts"));
  });
  it("rejects path traversal", () => {
    expect(safeResolveFile(dir, "../secret.txt")).toBeNull();
    expect(safeResolveFile(dir, "..\\..\\secret.txt")).toBeNull();
  });
  it("rejects absolute paths outside workdir", () => {
    expect(safeResolveFile(dir, "C:/Windows/system32/config")).toBeNull();
  });
});

describe("listRunFiles", () => {
  it("lists files recursively with / separators, excluding trajectory.jsonl", () => {
    writeFileSync(path.join(dir, "hello.txt"), "hi");
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "main.ts"), "x");
    writeFileSync(path.join(dir, "trajectory.jsonl"), "{}");
    const files = listRunFiles(dir);
    expect(files.map((f) => f.path)).toEqual(["hello.txt", "src/main.ts"]);
    expect(files[0].size).toBe(2);
  });

  it("目录不存在时返回空列表（tmp 被清理后的'有 DB 无目录'场景）", () => {
    expect(listRunFiles(path.join(dir, "no-such-dir"))).toEqual([]);
  });

  it("子目录消失时跳过该子树不抛错", () => {
    writeFileSync(path.join(dir, "keep.txt"), "k");
    mkdirSync(path.join(dir, "vanish"));
    writeFileSync(path.join(dir, "vanish", "x.txt"), "x");
    const files = listRunFiles(dir);
    expect(files.map((f) => f.path)).toEqual(["keep.txt", "vanish/x.txt"]);
  });
});

describe("readTrajectory 逐行容错", () => {
  it("单行损坏只跳过该行并插入 warn 标记，其余事件完整返回", () => {
    const good1 = JSON.stringify({ kind: "message", text: "t1", ts: 1 });
    const good2 = JSON.stringify({ kind: "done", ts: 2 });
    writeFileSync(path.join(dir, "trajectory.jsonl"), `${good1}\n{"kind":"broken"\n${good2}\n`);
    const events = readTrajectory(dir);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "message", text: "t1" });
    expect(events[1].kind).toBe("warn"); // 损坏行 → warn 标记
    expect(events[2]).toMatchObject({ kind: "done" });
    invalidateTrajectoryCache(dir);
  });

  it("无换行结尾的最后一行（正常事件）也能解析", () => {
    writeFileSync(path.join(dir, "trajectory.jsonl"), JSON.stringify({ kind: "message", text: "tail", ts: 9 }));
    const events = readTrajectory(dir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "message", text: "tail" });
    invalidateTrajectoryCache(dir);
  });
});

describe("readRunFile", () => {
  it("reads content with size", () => {
    writeFileSync(path.join(dir, "hello.txt"), "hi");
    expect(readRunFile(dir, "hello.txt")).toEqual({ content: "hi", truncated: false, size: 2 });
  });
  it("returns null on traversal attempt", () => {
    expect(readRunFile(dir, "../x.txt")).toBeNull();
  });
});

describe("extractPreviewUrl", () => {
  it("从 Next.js 启动输出中嗅探 URL（Network 地址不在本机白名单内被忽略）", () => {
    const out = "▲ Next.js 15.2.4\n- Local: http://localhost:3001\n- Network: http://192.168.1.5:3001";
    expect(extractPreviewUrl(out)).toBe("http://localhost:3001");
  });
  it("vite 输出带尾斜杠", () => {
    expect(extractPreviewUrl("  ➜  Local:   http://localhost:5173/")).toBe("http://localhost:5173/");
  });
  it("127.0.0.1 与 0.0.0.0（归一化为 localhost）", () => {
    expect(extractPreviewUrl("listening on http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(extractPreviewUrl("listening on http://0.0.0.0:8080")).toBe("http://localhost:8080");
  });
  it("剔除尾部粘连的中英文标点", () => {
    expect(extractPreviewUrl("访问 http://localhost:3001。")).toBe("http://localhost:3001");
    expect(extractPreviewUrl("访问 (http://localhost:3001)")).toBe("http://localhost:3001");
  });
  it("拒绝非本机地址与伪装域名", () => {
    expect(extractPreviewUrl("see https://example.com")).toBeNull();
    expect(extractPreviewUrl("http://localhost.evil.com")).toBeNull();
    expect(extractPreviewUrl("http://localhost:3001.evil.com")).toBeNull();
  });
  it("拒绝非法端口", () => {
    expect(extractPreviewUrl("http://localhost:99999")).toBeNull();
  });
  it("拒绝黑名单端口（默认含本服务前端 3000）", () => {
    expect(extractPreviewUrl("本竞技场运行在 http://localhost:3000")).toBeNull();
  });
  it("ARENA_PREVIEW_PORT_BLACKLIST 可追加黑名单端口", () => {
    process.env.ARENA_PREVIEW_PORT_BLACKLIST = "5173, 8080";
    try {
      expect(extractPreviewUrl("Local: http://localhost:5173")).toBeNull();
      expect(extractPreviewUrl("listening on http://0.0.0.0:8080")).toBeNull();
      expect(extractPreviewUrl("ok http://localhost:4321")).toBe("http://localhost:4321");
    } finally {
      delete process.env.ARENA_PREVIEW_PORT_BLACKLIST;
    }
  });
  it("无 URL 返回 null", () => {
    expect(extractPreviewUrl("no url here")).toBeNull();
  });
});

describe("preview-url 约定文件", () => {
  it("写入后可读出；缺失返回 null；不出现在产出文件列表", () => {
    expect(readPreviewUrl(dir)).toBeNull();
    savePreviewUrl(dir, "http://localhost:3001");
    expect(readPreviewUrl(dir)).toBe("http://localhost:3001");
    savePreviewUrl(dir, "http://localhost:3001"); // 内容不变不重写（重复调用不报错）
    expect(readPreviewUrl(dir)).toBe("http://localhost:3001");
    expect(listRunFiles(dir).map((f) => f.path)).not.toContain(PREVIEW_URL_FILE);
  });
  it("地址更新时覆盖旧值", () => {
    savePreviewUrl(dir, "http://localhost:3001");
    savePreviewUrl(dir, "http://localhost:4321");
    expect(readPreviewUrl(dir)).toBe("http://localhost:4321");
  });
  it("文件内容不合法时读取返回 null", () => {
    mkdirSync(path.join(dir, ".arena"));
    writeFileSync(path.join(dir, PREVIEW_URL_FILE), "https://example.com");
    expect(readPreviewUrl(dir)).toBeNull();
  });
  it("黑名单端口的存量文件读取返回 null", () => {
    mkdirSync(path.join(dir, ".arena"));
    writeFileSync(path.join(dir, PREVIEW_URL_FILE), "http://localhost:3000");
    expect(readPreviewUrl(dir)).toBeNull();
  });
});

describe("previewUrlPort", () => {
  it("解析显式端口", () => {
    expect(previewUrlPort("http://localhost:3000")).toBe(3000);
    expect(previewUrlPort("http://localhost:5173/")).toBe(5173);
  });
  it("无端口或非法 URL 返回 null", () => {
    expect(previewUrlPort("http://localhost")).toBeNull();
    expect(previewUrlPort("not-a-url")).toBeNull();
  });
});

describe("clearPreviewUrl", () => {
  it("删除预览地址文件；缺失时静默", () => {
    savePreviewUrl(dir, "http://localhost:3000");
    clearPreviewUrl(dir);
    expect(readPreviewUrl(dir)).toBeNull();
    expect(() => clearPreviewUrl(dir)).not.toThrow();
  });
});
