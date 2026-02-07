import { NextResponse } from "next/server";
import { getGameTimeline } from "@/db/gameService";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const timeline = await getGameTimeline(gameId, { limit: Number.isFinite(limit) ? limit : undefined });
    return NextResponse.json(timeline);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

