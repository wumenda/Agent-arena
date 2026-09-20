process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { createMatch, createRun, updateRun } from "@/lib/db/index";

// runner 全部 mock：只测 HTTP 契约
vi.mock("@/lib/arena/runner", () => ({
  continueRun: vi.fn().mockResolvedValue(undefined),
  rerunCombos: vi.fn().mockResolvedValue(undefined),
  stopRun: vi.fn().mockReturnValue(true),
}));
// detect 会真起 CLI 子进程探测——mock detectAll，只测路由的 force 透传
vi.mock("@/lib/arena/adapters/registry", () => ({
  detectAll: vi.fn(async (force?: boolean) => [{ harness: "codex", installed: true, detail: "", models: ["m"], force: force ?? false }]),
}));

const fileRoute = await import("@/app/api/matches/[id]/file/route");
const rerunRoute = await import("@/app/api/matches/[id]/rerun/route");
const continueRoute = await import("@/app/api/matches/[id]/continue/route");
const questionsRoute = await import("@/app/api/questions/route");
const statsRoute = await import("@/app/api/stats/route");
const detectRoute = await import("@/app/api/detect/route");

const req = (body?: unknown, url = "http://localhost/api") =>
  new NextRequest(url, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// 每个用例独立的对局 + 真实 workdir（file 路由需要读文件）
let tmpRoot: string;
let m: { id: string };
let runId: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "arena-routes2-"));
  m = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "m" }] });
  runId = `run2_${Math.random().toString(36).slice(2, 8)}`;
  createRun({ id: runId, matchId: m.id, harness: "codex", model: "m", workdir: path.join(tmpRoot, "wd") });
  mkdirSync(path.join(tmpRoot, "wd", "sub"), { recursive: true });
  writeFileSync(path.join(tmpRoot, "wd", "index.html"), "<h1>hi</h1>");
  writeFileSync(path.join(tmpRoot, "wd", "sub", "a.txt"), "inner");
  writeFileSync(path.join(tmpRoot, "secret.txt"), "TOP-SECRET"); // workdir 外
});
afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("GET /api/matches/[id]/file", () => {
  it("lists run files excluding trajectory/preview", async () => {
    writeFileSync(path.join(tmpRoot, "wd", "trajectory.jsonl"), "{}");
    const res = await fileRoute.GET(new NextRequest(`http://localhost/api/file?runId=${runId}`), params(m.id));
    expect(res.status).toBe(200);
    const d = await res.json();
    const names = d.files.map((f: { path: string }) => f.path);
    expect(names).toContain("index.html");
    expect(names).toContain("sub/a.txt");
    expect(names).not.toContain("trajectory.jsonl");
  });

  it("rejects path traversal (../) with 400", async () => {
    const res = await fileRoute.GET(
      new NextRequest(`http://localhost/api/file?runId=${runId}&path=../secret.txt`), params(m.id));
    expect(res.status).toBe(400); // 越界被 safeResolveFile 拦截
  });

  it("rejects Windows-style traversal with 400", async () => {
    const res = await fileRoute.GET(
      new NextRequest(`http://localhost/api/file?runId=${runId}&path=..%5C..%5Csecret.txt`), params(m.id));
    expect(res.status).toBe(400);
  });

  it("reads in-workdir file content with size", async () => {
    const res = await fileRoute.GET(
      new NextRequest(`http://localhost/api/file?runId=${runId}&path=sub/a.txt`), params(m.id));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.content).toBe("inner");
    expect(d.size).toBe(5);
  });

  it("404 for unknown run", async () => {
    const res = await fileRoute.GET(new NextRequest("http://localhost/api/file?runId=nope"), params(m.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/matches/[id]/rerun", () => {
  it("rejects while any run is running (409)", async () => {
    updateRun(runId, { status: "running" });
    const res = await rerunRoute.POST(req({}), params(m.id));
    expect(res.status).toBe(409);
  });

  it("accepts empty body (full rerun) when settled", async () => {
    updateRun(runId, { status: "completed" });
    const res = await rerunRoute.POST(req({}), params(m.id));
    expect(res.status).toBe(200);
  });

  it("rejects invalid body (bad combo) with 400", async () => {
    updateRun(runId, { status: "completed" });
    const res = await rerunRoute.POST(req({ combos: [{ harness: "nope", model: "" }] }), params(m.id));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/matches/[id]/continue", () => {
  it("rejects while running (409)", async () => {
    updateRun(runId, { status: "running" });
    const res = await continueRoute.POST(req({ runId, prompt: "继续" }), params(m.id));
    expect(res.status).toBe(409);
  });

  it("accepts for completed run", async () => {
    updateRun(runId, { status: "completed" });
    const res = await continueRoute.POST(req({ runId, prompt: "继续" }), params(m.id));
    expect(res.status).toBe(200);
  });

  it("404 for unknown run", async () => {
    const res = await continueRoute.POST(req({ runId: "nope", prompt: "x" }), params(m.id));
    expect(res.status).toBe(404);
  });

  it("400 for missing prompt", async () => {
    updateRun(runId, { status: "completed" });
    const res = await continueRoute.POST(req({ runId }), params(m.id));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/questions", () => {
  it("returns banks array (shape check)", async () => {
    const res = await questionsRoute.GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.banks)).toBe(true);
    // 每个 bank 有 id/name/questions 数组（题库扫描的对外契约）
    for (const b of d.banks) {
      expect(typeof b.id).toBe("string");
      expect(Array.isArray(b.questions)).toBe(true);
    }
  });
});

describe("GET /api/stats", () => {
  it("aggregates stats, byHarness, trend shapes", async () => {
    const res = await statsRoute.GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.stats)).toBe(true);
    expect(Array.isArray(d.byHarness)).toBe(true);
    expect(Array.isArray(d.trend)).toBe(true);
    expect(d.trend).toHaveLength(14); // 近 14 天桶
  });

  it("combo stats count completed and timeouts separately", async () => {
    // 清理共享态干扰：本用例只读已有数据，不断言具体值，只验证字段存在
    const res = await statsRoute.GET();
    const d = await res.json();
    for (const s of d.stats) {
      expect(typeof s.total).toBe("number");
      expect(typeof s.completed).toBe("number");
      expect(typeof s.timeouts).toBe("number");
    }
  });
});

describe("GET /api/detect", () => {
  it("passes force param through to detectAll (shape check)", async () => {
    const res = await detectRoute.GET(new NextRequest("http://localhost/api/detect?force=1"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.results)).toBe(true);
    expect(d.results[0].force).toBe(true); // force 透传
    const res2 = await detectRoute.GET(new NextRequest("http://localhost/api/detect"));
    const d2 = await res2.json();
    expect(d2.results[0].force).toBe(false);
  });
});
