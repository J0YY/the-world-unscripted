import { NextResponse } from "next/server";
import { getResolutionReport } from "@/db/gameService";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const turn = url.searchParams.get("turn");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    if (!turn) return NextResponse.json({ error: "Missing turn" }, { status: 400 });
    const turnNumber = Number(turn);
    if (!Number.isFinite(turnNumber)) return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
    const report = await getResolutionReport(gameId, turnNumber);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

