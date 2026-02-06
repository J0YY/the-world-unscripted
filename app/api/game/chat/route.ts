import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { llmAgentChat, llmMode } from "@/db/llm";
import type { WorldState } from "@/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (llmMode() === "OFF") {
      return NextResponse.json({ error: "AI is offline" }, { status: 503 });
    }

    const { gameId, message } = await req.json();
    if (!gameId || !message) {
      return NextResponse.json({ error: "Missing gameId or message" }, { status: 400 });
    }

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    // We use the full world state for the context, not just the snapshot
    const world = game.worldState as unknown as WorldState;

    const reply = await llmAgentChat({ world, userMessage: message });

    return NextResponse.json({ reply });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
