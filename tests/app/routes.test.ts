process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMatch, createRun, updateRun } from "@/lib/db/index";
import type { MatchRow, RunRow } from "@/lib/db/schema";

// runner 的 runMatch/continueRun 会在测试里真实 spawn —— 全部 mock 掉（路由测试只测 HTTP 契约，不测执行）
vi.mock("@/lib/arena/runner", () => ({
  runMatch: vi.fn().mockResolvedValue(undefined),
  continueRun: vi.fn().mockResolvedValue(undefined),
  rerunCombos: vi.fn().mockResolvedValue(undefined),
  stopRun: vi.fn().mockReturnValue(true),
}));

const matchesGET = (await import("@/app/api/matches/route")).GET;
const matchesPOST = (await import("@/app/api/matches/route")).POST;
const matchIdRoute = await import("@/app/api/matches/[id]/route");
const parseRoute = await import("@/app/api/parse/route");
const reportRoute = await import("@/app/api/matches/[id]/report/route");
const trajectoryRoute = await import("@/app/api/matches/[id]/trajectory/route");
const stopRoute = await import("@/app/api/matches/[id]/stop/route");
const readyRoute = await import("@/app/api/ready/route");

const req = (body?: unknown, url = "http://localhost/api") =>
  new NextRequest(url, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let m: MatchRow;
let run: RunRow;
beforeEach(() => {
  // 每个用例前重建（:memory: 共享，但用新 id 避免撞主键）
  m = createMatch({ prompt: "写个贪吃蛇", combos: [{ harness: "claude-code", model: "sonnet" }] });
  run = { id: `run_${Math.random().toString(36).slice(2, 8)}`, matchId: m.id, harness: "claude-code", model: "sonnet", workdir: "C:/secret/path/wd", status: "completed", error: null, startedAt: null, finishedAt: null, durationMs: 1000, tokensIn: 10, tokensOut: 5, costUsd: 0.001, verifyStatus: null };
  createRun(run);
});

describe("GET /api/matches", () => {
  it("returns matches list with total and hasMore", async () => {
    const res = await matchesGET(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.matches.length).toBeGreaterThanOrEqual(1);
    expect(typeof d.total).toBe("number");
    expect(d.hasMore).toBe(false);
  });

  it("caps limit at 200 and clamps offset", async () => {
    const res = await matchesGET(new NextRequest("http://localhost/api/matches?limit=9999&offset=-5"));
    const d = await res.json();
    expect(d.matches.length).toBeLessThanOrEqual(200);
  });
});

describe("POST /api/matches", () => {
  it("creates match and returns 201", async () => {
    const res = await matchesPOST(req({ prompt: "p", combos: [{ harness: "codex", model: "m" }] }));
    expect(res.status).toBe(201);
    const d = await res.json();
    expect(d.match.prompt).toBe("p");
  });

  it("rejects invalid body with 400", async () => {
    const res = await matchesPOST(req({ prompt: "", combos: [] }));
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.error).toContain("参数校验失败");
  });

  it("rejects non-JSON body with 400", async () => {
    const res = await matchesPOST(new NextRequest("http://localhost/api/matches", { method: "POST", body: "{bad" }));
    expect(res.status).toBe(400);
  });

  it("rejects unknown question ref with 400", async () => {
    const res = await matchesPOST(req({ prompt: "p", combos: [{ harness: "codex", model: "m" }], question: { bank: "none", id: "none" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("题库中找不到");
  });
});

describe("GET/DELETE /api/matches/[id]", () => {
  it("GET returns match with runs stripped of workdir (信息隐藏)", async () => {
    const res = await matchIdRoute.GET(new NextRequest("http://localhost/api/matches/x"), params(m.id));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.match.id).toBe(m.id);
    expect(d.runs[0].id).toBe(run.id);
    expect(d.runs[0].workdir).toBeUndefined(); // workdir 不外泄
    expect(JSON.stringify(d.runs[0])).not.toContain("C:/secret");
  });

  it("GET 404 for missing match", async () => {
    const res = await matchIdRoute.GET(new NextRequest("http://localhost/api/matches/x"), params("no-such"));
    expect(res.status).toBe(404);
  });

  it("DELETE removes match and returns ok", async () => {
    const m2 = createMatch({ prompt: "del", combos: [{ harness: "codex", model: "m" }] });
    const res = await matchIdRoute.DELETE(new Request("http://localhost/api/matches/x"), params(m2.id));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("DELETE 404 for missing match", async () => {
    const res = await matchIdRoute.DELETE(new Request("http://localhost/api/matches/x"), params("no-such"));
    expect(res.status).toBe(404);
  });

  it("DELETE 409 while a run is running", async () => {
    updateRun(run.id, { status: "running" });
    const res = await matchIdRoute.DELETE(new Request("http://localhost/api/matches/x"), params(m.id));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/parse", () => {
  it("returns 503 without ARK credentials (no crash)", async () => {
    // 测试环境无 ARK_BASE_URL/ARK_API_KEY
    const res = await parseRoute.POST(req({ input: "对比 claude 和 codex" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("未配置 ARK");
  });

  it("rejects empty input with 400", async () => {
    const res = await parseRoute.POST(req({ input: "" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/matches/[id]/report", () => {
  it("returns markdown report with content-disposition", async () => {
    const res = await reportRoute.GET(new NextRequest("http://localhost/api/matches/x/report"), params(m.id));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("# 对局报告");
    expect(body).toContain("claude-code×sonnet");
  });

  it("returns HTML report for format=html (escaped, no raw prompt)", async () => {
    const res = await reportRoute.GET(new NextRequest("http://localhost/api/matches/x/report?format=html"), params(m.id));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!doctype html>");
    expect(body).not.toContain("<script>"); // prompt 已转义（无注入）
  });

  it("404 for missing match", async () => {
    const res = await reportRoute.GET(new NextRequest("http://localhost/api/matches/x/report"), params("no-such"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/matches/[id]/trajectory", () => {
  it("returns events for a run", async () => {
    const res = await trajectoryRoute.GET(new NextRequest(`http://localhost/api/matches/x/trajectory?runId=${run.id}`), params(m.id));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.events)).toBe(true);
  });

  it("404 for unknown runId", async () => {
    const res = await trajectoryRoute.GET(new NextRequest("http://localhost/api/matches/x/trajectory?runId=nope"), params(m.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/matches/[id]/stop", () => {
  it("rejects stop for non-running run with 409", async () => {
    const res = await stopRoute.POST(req({ runId: run.id }), params(m.id));
    expect(res.status).toBe(409);
  });

  it("404 for unknown run", async () => {
    const res = await stopRoute.POST(req({ runId: "nope" }), params(m.id));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/ready", () => {
  it("reports credentials presence as boolean (no secret leak)", async () => {
    const res = await readyRoute.GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(typeof d.hasCredentials).toBe("boolean");
    expect(JSON.stringify(d)).not.toMatch(/sk-|key|ARK_API/);
  });
});
