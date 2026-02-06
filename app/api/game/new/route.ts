import { NextResponse } from "next/server";
import { createGame } from "@/db/gameService";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { seed?: string };
    const snapshot = await createGame(body.seed);
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

