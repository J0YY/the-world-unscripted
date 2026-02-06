import { NextResponse } from "next/server";
import { debugExportTrueState } from "@/db/gameService";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    if (!gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const data = await debugExportTrueState(gameId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
}

