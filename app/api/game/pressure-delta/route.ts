import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import type { GameSnapshot } from "@/engine";

export const runtime = "nodejs";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computePressureIndex(snapshot: GameSnapshot): number {
  const ind = snapshot.playerView.indicators;
  const cred = ind.internationalCredibility.estimatedValue;
  const econ = ind.economicStability.estimatedValue;
  const infl = ind.inflationPressure.estimatedValue;
  const sov = ind.sovereigntyIntegrity.estimatedValue;
  const war = ind.warStatus.estimatedValue;
  const unrest = ind.unrestLevel.estimatedValue;
  return Math.round(
    clamp(
      (100 - sov) * 0.32 +
        unrest * 0.2 +
        infl * 0.18 +
        war * 0.16 +
        (100 - cred) * 0.08 +
        (100 - econ) * 0.06,
      0,
      100,
    ),
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const turnRaw = url.searchParams.get("turn");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    if (!turnRaw) return NextResponse.json({ error: "Missing turn" }, { status: 400 });
    const turn = Number(turnRaw);
    if (!Number.isFinite(turn)) return NextResponse.json({ error: "Invalid turn" }, { status: 400 });

    if (turn <= 1) return NextResponse.json({ deltaPerTurn: null });

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

    const current = game.lastPlayerSnapshot as unknown as GameSnapshot;
    if (!current || typeof current !== "object") return NextResponse.json({ deltaPerTurn: null });

    // Prefer the explicit requested turn, but fall back to latest snapshot.
    const currentSnap = current.turn === turn ? current : current;

    const prevLog = await prisma.turnLog.findFirst({
      where: { gameId, turnNumber: turn - 1 },
    });
    if (!prevLog) return NextResponse.json({ deltaPerTurn: null });
    const prevWrapped = prevLog.playerSnapshot as unknown as { after?: GameSnapshot } | GameSnapshot;
    const prevSnap = (prevWrapped && typeof prevWrapped === "object" && "after" in prevWrapped ? (prevWrapped as { after?: GameSnapshot }).after : prevWrapped) as
      | GameSnapshot
      | undefined;
    if (!prevSnap) return NextResponse.json({ deltaPerTurn: null });

    const deltaPerTurn = computePressureIndex(currentSnap) - computePressureIndex(prevSnap);
    return NextResponse.json({ deltaPerTurn });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

