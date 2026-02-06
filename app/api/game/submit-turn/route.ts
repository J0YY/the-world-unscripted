import { NextResponse } from "next/server";
import { submitTurn } from "@/db/gameService";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { gameId?: string; actions?: unknown; directive?: string };
    if (!body.gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const outcome = await submitTurn(body.gameId, body.actions ?? [], body.directive);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

