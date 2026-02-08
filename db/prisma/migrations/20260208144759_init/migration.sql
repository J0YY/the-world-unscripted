-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentTurn" INTEGER NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "playerCountryName" TEXT NOT NULL,
    "lastPlayerSnapshot" JSONB NOT NULL,
    "worldState" JSONB NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

    CONSTRAINT "TurnLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TurnLog_gameId_turnNumber_idx" ON "TurnLog"("gameId", "turnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TurnLog_gameId_turnNumber_key" ON "TurnLog"("gameId", "turnNumber");

-- AddForeignKey
ALTER TABLE "TurnLog" ADD CONSTRAINT "TurnLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
