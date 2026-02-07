import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { llmDiplomacyChat, llmMode } from "@/db/llm";
import type { GameSnapshot, WorldState } from "@/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (llmMode() !== "ON") {
      return NextResponse.json({ error: "AI mode is OFF" }, { status: 400 });
    }
    const { gameId, nationId, message } = await req.json();
    if (!gameId || !nationId || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    // deep copy snapshot so we can mutate and save
    const snapshot = JSON.parse(JSON.stringify(game.lastPlayerSnapshot)) as GameSnapshot;
    
    // Check if diplomacy exists
    if (!snapshot.diplomacy) {
        // Should have been generated, but if old game, might be missing.
        return NextResponse.json({ error: "Diplomacy not initialized for this game" }, { status: 400 });
    }

    const nationIndex = snapshot.diplomacy.nations.findIndex((n) => n.id === nationId);
    if (nationIndex === -1) {
      return NextResponse.json({ error: "Nation not found" }, { status: 404 });
    }

    const nation = snapshot.diplomacy.nations[nationIndex];
    const history = nation.chatHistory || [];
    const world = game.worldState as unknown as WorldState;

    const result = await llmDiplomacyChat({
      world,
      nation,
      userMessage: message,
      history: history.map((h) => ({ role: h.role as "user" | "minister", text: h.text })),
    });

    const { reply, trustChange, headline } = result;

    const newHistory = [
      ...history,
      { role: "user" as const, text: message, timestamp: Date.now() },
      { role: "minister" as const, text: reply, timestamp: Date.now() },
    ];

    // Update UI View
    snapshot.diplomacy.nations[nationIndex].chatHistory = newHistory;

    // Apply World State Impacts (Trust & Headlines)
    let worldUpdated = false;
    if (trustChange && trustChange !== 0) {
        // Find actor in world state (nationId should match actor.id)
        const actorKey = Object.keys(world.actors).find((k) => world.actors[k as keyof typeof world.actors].id === nationId);
        if (actorKey) {
            const actor = world.actors[actorKey as keyof typeof world.actors];
            const oldTrust = actor.trust;
            actor.trust = Math.max(0, Math.min(100, actor.trust + trustChange));
            // Sync local snapshot view
            snapshot.diplomacy.nations[nationIndex].stance = actor.trust;
            worldUpdated = true;
            console.log(`Diplomacy: ${nationId} trust changed ${oldTrust} -> ${actor.trust} (${trustChange})`);
        }
    }

    if (headline) {
        // `world.current.briefing` is expected to exist, but guard against old shapes.
        if (!world.current.briefing) {
          world.current.briefing = {
            text: "",
            headlines: [],
            domesticRumors: [],
            diplomaticMessages: [],
            intelBriefs: [],
          };
        }
        world.current.briefing.headlines.unshift(headline);
        if (world.current.briefing.headlines.length > 6) {
             world.current.briefing.headlines.pop();
        }
        worldUpdated = true;
        console.log(`Diplomacy: Generated Headline: "${headline}"`);
    }

    const dataToUpdate: { lastPlayerSnapshot: object; worldState?: object } = {
      lastPlayerSnapshot: snapshot as unknown as object,
    };
    if (worldUpdated) {
        dataToUpdate.worldState = world as unknown as object;
    }

    await prisma.game.update({
      where: { id: gameId },
      data: dataToUpdate,
    });

    return NextResponse.json({ reply, history: newHistory });
  } catch (err) {
    console.error("Diplomacy chat error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
