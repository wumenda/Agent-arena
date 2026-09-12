import { NextRequest } from "next/server";
import { subscribe, type BusEvent } from "@/lib/arena/bus";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
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
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
