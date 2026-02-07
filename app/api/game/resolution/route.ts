import { NextResponse } from "next/server";
import { getResolutionReport } from "@/db/gameService";

export const runtime = "nodejs";

declare global {
  var __twuoResolutionInflight: Map<string, Promise<unknown>> | undefined;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const turn = url.searchParams.get("turn");
    const forceLlm = url.searchParams.get("forceLlm") === "1";
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    if (!turn) return NextResponse.json({ error: "Missing turn" }, { status: 400 });
    const turnNumber = Number(turn);
    if (!Number.isFinite(turnNumber)) return NextResponse.json({ error: "Invalid turn" }, { status: 400 });

    // In-flight de-dupe: prevents request storms from triggering multiple concurrent
    // resolution generations (and burning credits) for the same game+turn.
    const inflight = (globalThis.__twuoResolutionInflight ??= new Map<string, Promise<unknown>>());
    // Include forceLlm in key so a "forced" request can't be satisfied by a non-forced in-flight request.
    const key = `${gameId}:${turnNumber}:${forceLlm ? 1 : 0}`;
    const existing = inflight.get(key);
    if (existing) {
      const report = await existing;
      return NextResponse.json(report);
    }

    const p = getResolutionReport(gameId, turnNumber, { forceLlm }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    const report = await p;
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

