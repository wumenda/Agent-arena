import { EventEmitter } from "node:events";
import type { RunDTO } from "@/lib/db/schema";
import type { ArenaEvent } from "./types";

export type BusEvent =
  | { channel: "run-status"; matchId: string; runId: string; status: string; error?: string; run: RunDTO }
  | { channel: "run-event"; matchId: string; runId: string; event: ArenaEvent }
  | { channel: "match-status"; matchId: string; status: string };

export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const emit = (e: BusEvent) => bus.emit("arena", e);
export const subscribe = (fn: (e: BusEvent) => void) => {
  bus.on("arena", fn);
  return () => bus.off("arena", fn);
};
