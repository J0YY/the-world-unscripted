import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/db/gameService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const snap = await getLatestSnapshot();
    return NextResponse.json({ snapshot: snap });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

