-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seed" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentTurn" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "playerCountryName" TEXT NOT NULL,
    "lastPlayerSnapshot" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "TurnLog" (
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
    CONSTRAINT "TurnLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TurnLog_gameId_turnNumber_idx" ON "TurnLog"("gameId", "turnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TurnLog_gameId_turnNumber_key" ON "TurnLog"("gameId", "turnNumber");
