
import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { GameSnapshot } from "@/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { gameId, amount } = await req.json();

    if (!gameId) {
      return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
       return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    // Load current snapshot
    const snapshot = (game.lastPlayerSnapshot || {}) as GameSnapshot;
    
    // Update intelligence clarity
    const currentClarity = snapshot.playerView.indicators.intelligenceClarity.estimatedValue || 50;
    const newClarity = Math.min(100, currentClarity + (amount || 15));
    
    snapshot.playerView.indicators.intelligenceClarity.estimatedValue = newClarity;
    snapshot.playerView.indicators.intelligenceClarity.confidence = "high";
    
    // Also reduce fog of war slightly by upgrading random incomplete signals?
    // For now, just the raw stat boost is a good start.

    await prisma.game.update({
      where: { id: gameId },
      data: {
        lastPlayerSnapshot: snapshot as unknown as object,
      },
    });

    return NextResponse.json({ success: true, newClarity });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
