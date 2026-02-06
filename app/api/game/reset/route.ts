import { NextResponse } from "next/server";
import { resetAllGames } from "@/db/gameService";

export const runtime = "nodejs";

export async function POST() {
  try {
    await resetAllGames();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

