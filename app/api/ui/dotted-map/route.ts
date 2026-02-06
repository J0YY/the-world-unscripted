import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    process.env.DOTTED_MAP_PATH || "",
    // If the UI folder was added inside the repo/workspace:
    path.join(cwd, "ui-testing-twi-main/app/data/dotted-map-data.json"),
    path.join(cwd, "../ui-testing-twi-main/app/data/dotted-map-data.json"),
    // Original location in this machine’s workspace snapshot:
    "/Users/joyyang/Downloads/ui-testing-twi-main/app/data/dotted-map-data.json",
  ].filter(Boolean);
}

export async function GET() {
  const candidates = candidatePaths();
  let chosen: string | null = null;
  for (const c of candidates) {
    if (await fileExists(c)) {
      chosen = c;
      break;
    }
  }

  if (!chosen) {
    return NextResponse.json(
      {
        error:
          "Dotted map dataset not found. Set DOTTED_MAP_PATH in .env.local to the ui-testing-twi-main/app/data/dotted-map-data.json file.",
        tried: candidates,
      },
      { status: 404 },
    );
  }

  const raw = await fs.readFile(chosen, "utf8");
  // Return as parsed JSON (keeps consumer simple).
  const data = JSON.parse(raw) as unknown;
  return NextResponse.json({ data });
}

