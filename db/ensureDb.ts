import { prisma } from "./client";

type TableInfoRow = { name: string };

let ensured: Promise<void> | null = null;

/**
 * Hackathon-safe DB forward-compat:
 * If schema changes were pulled without running Prisma migrations locally,
 * ensure required columns exist to avoid runtime 400s.
 *
 * This only adds nullable columns (safe) and is idempotent.
 */
export function ensureDbSchema(): Promise<void> {
  if (!ensured) ensured = ensureOnce();
  return ensured;
}

async function ensureOnce(): Promise<void> {
  const cols = await prisma.$queryRawUnsafe<TableInfoRow[]>("PRAGMA table_info('TurnLog')");
  const names = new Set(cols.map((c) => c.name));

  // SQLite stores Prisma Json as TEXT under the hood.
  if (!names.has("playerDirective")) {
    await prisma.$executeRawUnsafe("ALTER TABLE TurnLog ADD COLUMN playerDirective TEXT");
  }
  if (!names.has("llmArtifacts")) {
    await prisma.$executeRawUnsafe("ALTER TABLE TurnLog ADD COLUMN llmArtifacts TEXT");
  }
}

