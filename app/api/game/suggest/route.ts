import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { llmMode, llmSuggestDirectives } from "@/db/llm";
import type { WorldState } from "@/engine";

export const runtime = "nodejs";

declare global {
  var __twuoSuggestInflight: Map<string, Promise<unknown>> | undefined;
  var __twuoSuggestCache: Map<string, { ts: number; data: unknown }> | undefined;
}

export async function POST(req: Request) {
  try {
    if (llmMode() === "OFF") {
      return NextResponse.json({ error: "AI is offline" }, { status: 503 });
    }

    const body = (await req.json()) as { gameId?: string };
    if (!body.gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });

    const game = await prisma.game.findUnique({ where: { id: body.gameId } });
    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

    const world = game.worldState as unknown as WorldState;

    const key = `${body.gameId}:${world.turn}`;
    const cache = (globalThis.__twuoSuggestCache ??= new Map<string, { ts: number; data: unknown }>());
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < 2 * 60 * 1000) {
      return NextResponse.json(hit.data);
    }

    const inflight = (globalThis.__twuoSuggestInflight ??= new Map<string, Promise<unknown>>());
    const existing = inflight.get(key);
    if (existing) {
      const data = await existing;
      return NextResponse.json(data);
    }

    const p = llmSuggestDirectives({ world })
      .then((out) => out.data)
      .then((data) => {
        cache.set(key, { ts: Date.now(), data });
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    const data = await p;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

