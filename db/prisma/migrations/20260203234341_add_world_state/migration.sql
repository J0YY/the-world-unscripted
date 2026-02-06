/*
  Warnings:

  - Added the required column `worldState` to the `Game` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
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
INSERT INTO "new_Game" ("createdAt", "currentTurn", "id", "lastPlayerSnapshot", "playerCountryName", "seed", "status", "updatedAt") SELECT "createdAt", "currentTurn", "id", "lastPlayerSnapshot", "playerCountryName", "seed", "status", "updatedAt" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
