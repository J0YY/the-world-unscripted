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
    // Default: committed into this repo so clones work out of the box.
    path.join(cwd, "app/data/dotted-map-data.json"),
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
          "Dotted map dataset not found. Commit app/data/dotted-map-data.json or set DOTTED_MAP_PATH in .env.local to point to dotted-map-data.json.",
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

