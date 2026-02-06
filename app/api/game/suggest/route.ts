import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { llmMode, llmSuggestDirectives } from "@/db/llm";
import type { WorldState } from "@/engine";

export const runtime = "nodejs";

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
    const out = await llmSuggestDirectives({ world });
    return NextResponse.json(out.data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

