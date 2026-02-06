import { PrismaClient } from "@prisma/client";
import path from "path";

declare global {
  var __prisma: PrismaClient | undefined;
}

// Compute the absolute path to the database file to ensure reliable connection
// regardless of where the script is executed from (CLI vs Runtime conflicts).
const getPrismaClient = () => {
  const dbPath = path.join(process.cwd(), "db", "unscripted.db");
  const url = process.env.DATABASE_URL ?? `file:${dbPath}`;
  
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url,
      },
    },
  });
};

export const prisma: PrismaClient = global.__prisma ?? getPrismaClient();

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

