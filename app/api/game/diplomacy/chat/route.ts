import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { llmDiplomacyChat, llmMode } from "@/db/llm";
import type { GameSnapshot, WorldState, ForeignPower } from "@/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { gameId, nationId, message } = await req.json();
    if (!gameId || !nationId || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    // deep copy snapshot so we can mutate and save
    const snapshot = JSON.parse(JSON.stringify(game.lastPlayerSnapshot)) as GameSnapshot;
    
    // Check if diplomacy exists
    if (!snapshot.diplomacy) {
        // Should have been generated, but if old game, might be missing.
        return NextResponse.json({ error: "Diplomacy not initialized for this game" }, { status: 400 });
    }

    const nationIndex = snapshot.diplomacy.nations.findIndex((n) => n.id === nationId);
    if (nationIndex === -1) {
      return NextResponse.json({ error: "Nation not found" }, { status: 404 });
    }

    const nation = snapshot.diplomacy.nations[nationIndex];
    const history = nation.chatHistory || [];
    const world = game.worldState as unknown as WorldState;

    const reply = await llmDiplomacyChat({
      world,
      nation,
      userMessage: message,
      history: history.map((h) => ({ role: h.role as "user" | "minister", text: h.text })),
    });

    const newHistory = [
      ...history,
      { role: "user" as const, text: message, timestamp: Date.now() },
      { role: "minister" as const, text: reply, timestamp: Date.now() },
    ];

    // Update
    snapshot.diplomacy.nations[nationIndex].chatHistory = newHistory;

    await prisma.game.update({
      where: { id: gameId },
      data: { lastPlayerSnapshot: snapshot as unknown as object },
    });

    return NextResponse.json({ reply, history: newHistory });
  } catch (err) {
    console.error("Diplomacy chat error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
