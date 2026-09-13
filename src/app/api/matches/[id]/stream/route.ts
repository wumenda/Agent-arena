import { NextRequest } from "next/server";
import { subscribe, type BusEvent } from "@/lib/arena/bus";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // retry：断线后浏览器 EventSource 的自动重连间隔（ms）；本地工具不做 Last-Event-ID 续传，靠重连后全量回放补偿
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      const send = (e: BusEvent) => {
        if ("matchId" in e && e.matchId === id) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        }
      };
      const unsub = subscribe(send);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 20000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
        try { controller.close(); } catch { /* 与入队竞态时流可能已关闭（ERR_INVALID_STATE），忽略 */ }
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
