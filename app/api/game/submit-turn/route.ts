import { NextResponse } from "next/server";
import { submitTurn } from "@/db/gameService";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { gameId?: string; actions?: unknown };
    if (!body.gameId) return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    const outcome = await submitTurn(body.gameId, body.actions ?? []);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

