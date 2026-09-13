import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db";
import { buildMatchReport, buildMatchReportHtml } from "@/lib/arena/report";
import { readTrajectory } from "@/lib/arena/files";
import { withMatch } from "@/lib/arena/http";

// 对局报告导出：format=html 导出自包含 HTML 单文件（最终回答完整不截断）；默认 markdown，full=1 时不截断
export const GET = withMatch(({ req, id, match }) => {
  const runs = listRuns(id);
  const eventsByRun = Object.fromEntries(runs.map((r) => [r.id, readTrajectory(r.workdir)]));
  if (req.nextUrl.searchParams.get("format") === "html") {
    const html = buildMatchReportHtml(match, runs, eventsByRun);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="match-${id}.html"`,
      },
    });
  }
  const full = req.nextUrl.searchParams.get("full") === "1";
  const md = buildMatchReport(match, runs, eventsByRun, { full });
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="match-${id}.md"`,
    },
  });
});
