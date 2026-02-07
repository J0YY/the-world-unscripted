import { NextResponse } from "next/server";
import { llmInterrogationChat } from "../../../../db/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { message, targetCountry, currentPressure, currentProgress } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const result = await llmInterrogationChat({
      targetCountry: targetCountry || "Unknown",
      userMessage: message,
      currentPressure: Number(currentPressure) || 0,
      currentProgress: Number(currentProgress) || 0
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
