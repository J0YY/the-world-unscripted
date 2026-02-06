import { NextResponse } from "next/server";
import { getTurnHistory } from "@/db/gameService";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const history = await getTurnHistory(gameId);
    return NextResponse.json(history);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

