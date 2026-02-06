import { prisma } from "./client";

type TableInfoRow = { name: string };
type SqliteMasterRow = { name: string };

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
  // If migrations haven't been applied, tables may not exist at all.
  // Create the minimal tables we need in an idempotent way.
  const tables = await prisma.$queryRawUnsafe<SqliteMasterRow[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Game','TurnLog')",
  );
  const tableNames = new Set(tables.map((t) => t.name));

  if (!tableNames.has("Game")) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Game" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "seed" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "currentTurn" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "playerCountryName" TEXT NOT NULL,
        "lastPlayerSnapshot" JSONB NOT NULL,
        "worldState" JSONB NOT NULL
      );
    `);
  }

  if (!tableNames.has("TurnLog")) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TurnLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "gameId" TEXT NOT NULL,
        "turnNumber" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "briefingText" TEXT NOT NULL,
        "incomingEvents" JSONB NOT NULL,
        "playerActions" JSONB NOT NULL,
        "publicResolution" TEXT NOT NULL,
        "publicConsequences" JSONB NOT NULL,
        "signalsUnknown" JSONB NOT NULL,
        "playerSnapshot" JSONB NOT NULL,
        "worldState" JSONB NOT NULL,
        "failure" JSONB,
        "playerDirective" TEXT,
        "llmArtifacts" JSONB,
        CONSTRAINT "TurnLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TurnLog_gameId_turnNumber_idx" ON "TurnLog"("gameId","turnNumber");`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TurnLog_gameId_turnNumber_key" ON "TurnLog"("gameId","turnNumber");`);
  }

  // Ensure required column exists in Game (older init migration lacked it).
  const gameCols = await prisma.$queryRawUnsafe<TableInfoRow[]>("PRAGMA table_info('Game')");
  const gameNames = new Set(gameCols.map((c) => c.name));
  if (!gameNames.has("worldState")) {
    // Safe default for existing rows; Prisma expects non-null.
    await prisma.$executeRawUnsafe("ALTER TABLE Game ADD COLUMN worldState JSONB NOT NULL DEFAULT '{}'");
  }

  const cols = await prisma.$queryRawUnsafe<TableInfoRow[]>("PRAGMA table_info('TurnLog')");
  const names = new Set(cols.map((c) => c.name));

  // SQLite stores Prisma Json as TEXT under the hood.
  if (!names.has("playerDirective")) {
    await prisma.$executeRawUnsafe("ALTER TABLE TurnLog ADD COLUMN playerDirective TEXT");
  }
  if (!names.has("llmArtifacts")) {
    await prisma.$executeRawUnsafe("ALTER TABLE TurnLog ADD COLUMN llmArtifacts JSONB");
  }
}

