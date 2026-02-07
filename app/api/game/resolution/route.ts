import { NextResponse } from "next/server";
import { getResolutionReport } from "@/db/gameService";

export const runtime = "nodejs";

declare global {
  var __twuoResolutionInflight: Map<string, Promise<unknown>> | undefined;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const turn = url.searchParams.get("turn");
    const forceLlm = url.searchParams.get("forceLlm") === "1";
    const waitMsRaw = url.searchParams.get("waitMs");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    if (!turn) return NextResponse.json({ error: "Missing turn" }, { status: 400 });
    const turnNumber = Number(turn);
    if (!Number.isFinite(turnNumber)) return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
    const waitMs = waitMsRaw ? clamp(Number(waitMsRaw), 0, 12_000) : 0;

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

    let report = await p;
    if (waitMs > 0) {
      const r = report as Record<string, unknown> | null;
      const pending = !!r && r.llmPending === true && !("llm" in r && r.llm);
      const err = !!r && typeof r.llmError === "string" && r.llmError.trim().length > 0;
      if (pending && !err) {
        // Prefer awaiting the in-flight background generation promise (if any), up to waitMs.
        const genKey = `${gameId}:${turnNumber}`;
        const genMap = (globalThis as unknown as { __twuoResolutionGenInflight?: Map<string, Promise<void>> }).__twuoResolutionGenInflight;
        const genPromise = genMap?.get(genKey);
        const startedAt = Date.now();
        const remaining = () => Math.max(0, waitMs - (Date.now() - startedAt));

        if (genPromise) {
          await Promise.race([genPromise, sleep(remaining())]);
        } else {
          // Fallback: small wait, then re-check.
          await sleep(Math.min(850, remaining()));
        }

        // Re-check once after the wait.
        report = await getResolutionReport(gameId, turnNumber, { forceLlm: false });
      }
    }

    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

