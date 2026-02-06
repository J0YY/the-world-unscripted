import { NextResponse } from "next/server";
import { getSnapshot } from "@/db/gameService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const snapshot = await getSnapshot(gameId);
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

