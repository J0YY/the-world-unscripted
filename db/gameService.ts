import { prisma } from "./client";
import { buildCountryProfile, PlayerActionSchema, type GameSnapshot, type PlayerAction, type TurnOutcome, type WorldState } from "@/engine";
import { createNewGameWorld, getPlayerSnapshot, submitTurnAndAdvance } from "@/engine";
import { llmGenerateCountryProfile, llmGenerateTurnPackage, llmMode, llmParsePlayerDirective } from "./llm";
import { ensureDbSchema } from "./ensureDb";

function newSeed(): string {
  // Deterministic engine requires a seed; generation of a *new* seed can be non-deterministic.
  return `seed-${crypto.randomUUID()}`;
}

export async function createGame(seed?: string): Promise<GameSnapshot> {
  await ensureDbSchema();
  const s = seed?.trim() ? seed.trim() : newSeed();
  const world = createNewGameWorld(s);

  // Optional LLM generation for Turn 1 briefing/events (replaces deterministic turn-start content).
  let llmArtifact: unknown | undefined;
  if (llmMode() === "ON") {
    try {
      const pkg = await llmGenerateTurnPackage({ world, phase: "TURN_1" });
      world.current.briefing = pkg.briefing;
      world.current.incomingEvents = pkg.events;
      llmArtifact = pkg.llmRaw;
    } catch {
      // Fail closed: proceed deterministically without LLM.
    }
  }

  const game = await prisma.game.create({
    data: {
      seed: s,
      currentTurn: world.turn,
      status: "ACTIVE",
      playerCountryName: world.player.name,
      worldState: world as unknown as object,
      lastPlayerSnapshot: {}, // filled immediately below
    },
  });

  const snapshot = getPlayerSnapshot(game.id, world, "ACTIVE");

  // Optional LLM-generated dossier (player-facing country profile). Fail closed to deterministic profile.
  if (llmMode() === "ON") {
    try {
      const ind = snapshot.playerView.indicators;
      const dossier = await llmGenerateCountryProfile({
        world,
        indicators: {
          economicStability: ind.economicStability,
          legitimacy: ind.legitimacy,
          unrestLevel: ind.unrestLevel,
          intelligenceClarity: ind.intelligenceClarity,
        },
      });
      snapshot.countryProfile = dossier.countryProfile;
      llmArtifact = llmArtifact ? { ...(llmArtifact as object), countryProfile: dossier.llmRaw } : { countryProfile: dossier.llmRaw };
    } catch {
      // Ignore: keep deterministic dossier.
    }
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { lastPlayerSnapshot: snapshot as unknown as object },
  });

  if (llmArtifact) {
    await prisma.turnLog.create({
      data: {
        gameId: game.id,
        turnNumber: 0,
        briefingText: world.current.briefing.text,
        incomingEvents: world.current.incomingEvents as unknown as object,
        playerActions: [] as unknown as object,
        publicResolution: "INIT",
        publicConsequences: [] as unknown as object,
        signalsUnknown: [] as unknown as object,
        playerSnapshot: snapshot as unknown as object,
        worldState: world as unknown as object,
        failure: undefined,
      },
    });
  }

  return snapshot;
}

export async function getLatestSnapshot(): Promise<GameSnapshot | null> {
  const game = await prisma.game.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!game) return null;
  const snap = game.lastPlayerSnapshot as unknown as GameSnapshot;
  // Backfill older snapshots (pre-dossier upgrade).
  if (!snap.countryProfile?.startingAssessment) {
    const world = game.worldState as unknown as WorldState;
    snap.countryProfile = buildCountryProfile(world, {
      economicStability: snap.playerView.indicators.economicStability,
      legitimacy: snap.playerView.indicators.legitimacy,
      unrestLevel: snap.playerView.indicators.unrestLevel,
      intelligenceClarity: snap.playerView.indicators.intelligenceClarity,
    });
  }
  return snap;
}

export async function getSnapshot(gameId: string): Promise<GameSnapshot> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error("Game not found");
  const snapshot = game.lastPlayerSnapshot as unknown as GameSnapshot;
  snapshot.llmMode = llmMode();

  // Backfill older snapshots (pre-dossier upgrade) so UI never crashes.
  if (!snapshot.countryProfile?.startingAssessment) {
    const world = game.worldState as unknown as WorldState;
    snapshot.countryProfile = buildCountryProfile(world, {
      economicStability: snapshot.playerView.indicators.economicStability,
      legitimacy: snapshot.playerView.indicators.legitimacy,
      unrestLevel: snapshot.playerView.indicators.unrestLevel,
      intelligenceClarity: snapshot.playerView.indicators.intelligenceClarity,
    });
    // Persist upgraded snapshot shape.
    await prisma.game.update({
      where: { id: gameId },
      data: { lastPlayerSnapshot: snapshot as unknown as object },
    });
  }

  return snapshot;
}

export async function submitTurn(
  gameId: string,
  actionsInput: unknown,
  playerDirective?: string,
): Promise<TurnOutcome> {
  await ensureDbSchema();
  const parsed = PlayerActionSchema.array().safeParse(actionsInput);
  if (!parsed.success) {
    throw new Error(`Invalid actions: ${parsed.error.message}`);
  }
  let actions: PlayerAction[] = parsed.data;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error("Game not found");
  if (game.status === "FAILED") throw new Error("Game already ended");

  const world = game.worldState as unknown as WorldState;
  const startBriefingText = world.current.briefing.text;
  const startIncomingEvents = world.current.incomingEvents;

  // If the player wrote a directive and LLM is enabled, translate into additional validated actions.
  let directiveArtifact: unknown | undefined;
  if (playerDirective?.trim() && llmMode() === "ON") {
    const remaining = Math.max(0, 2 - actions.length);
    if (remaining > 0) {
      try {
        const parsedDirective = await llmParsePlayerDirective({
          directive: playerDirective.trim(),
          world,
          remainingSlots: remaining,
        });
        actions = [...actions, ...parsedDirective.actions].slice(0, 2);
        directiveArtifact = parsedDirective.llmRaw;
      } catch {
        // Ignore directive on failure; continue with chosen actions.
      }
    }
  }

  const { world: nextWorld, outcome } = submitTurnAndAdvance(gameId, world, actions);

  // Optional LLM generation for next turn's briefing/events (replaces deterministic turn-start content).
  let llmArtifact: unknown | undefined;
  if (!outcome.failure && llmMode() === "ON") {
    try {
      const pkg = await llmGenerateTurnPackage({
        world: nextWorld,
        phase: "TURN_N",
        playerDirective: playerDirective?.trim() ? playerDirective.trim() : undefined,
        lastTurnPublicResolution: outcome.publicResolutionText,
      });
      nextWorld.current.briefing = pkg.briefing;
      nextWorld.current.incomingEvents = pkg.events;
      llmArtifact = pkg.llmRaw;
    } catch {
      // Proceed without LLM changes.
    }
  }

  // Keep artifacts available for future DB logging without tripping eslint unused checks.
  void directiveArtifact;
  void llmArtifact;

  // Fill failure timeline from the last 3 turns (if applicable).
  const failure = outcome.failure
    ? await fillFailureTimeline(gameId, outcome.failure)
    : undefined;

  const finalOutcome: TurnOutcome = failure ? { ...outcome, failure } : outcome;

  // Optional LLM-generated dossier refresh for the *next* snapshot.
  if (llmMode() === "ON") {
    try {
      const ind = finalOutcome.nextSnapshot.playerView.indicators;
      const dossier = await llmGenerateCountryProfile({
        world: nextWorld,
        indicators: {
          economicStability: ind.economicStability,
          legitimacy: ind.legitimacy,
          unrestLevel: ind.unrestLevel,
          intelligenceClarity: ind.intelligenceClarity,
        },
      });
      finalOutcome.nextSnapshot.countryProfile = dossier.countryProfile;
      llmArtifact = llmArtifact ? { ...(llmArtifact as object), countryProfile: dossier.llmRaw } : { countryProfile: dossier.llmRaw };
    } catch {
      // Ignore: keep deterministic dossier.
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.turnLog.create({
      data: {
        gameId,
        turnNumber: outcome.turnResolved,
        briefingText: startBriefingText,
        incomingEvents: startIncomingEvents as unknown as object,
        playerActions: actions as unknown as object,
        playerDirective: playerDirective?.trim() ? playerDirective.trim() : undefined,
        publicResolution: finalOutcome.publicResolutionText,
        publicConsequences: finalOutcome.consequences as unknown as object,
        signalsUnknown: finalOutcome.signalsUnknown as unknown as object,
        playerSnapshot: finalOutcome.nextSnapshot as unknown as object,
        worldState: nextWorld as unknown as object,
        failure: finalOutcome.failure ? (finalOutcome.failure as unknown as object) : undefined,
        llmArtifacts:
          directiveArtifact || llmArtifact
            ? ({
                directiveParse: directiveArtifact ?? null,
                nextTurnPackage: llmArtifact ?? null,
              } as unknown as object)
            : undefined,
      },
    });

    await tx.game.update({
      where: { id: gameId },
      data: {
        currentTurn: nextWorld.turn,
        status: finalOutcome.failure ? "FAILED" : "ACTIVE",
        worldState: nextWorld as unknown as object,
        lastPlayerSnapshot: finalOutcome.nextSnapshot as unknown as object,
      },
    });
  });

  return finalOutcome;
}

export async function resetAllGames(): Promise<void> {
  await prisma.$transaction([prisma.turnLog.deleteMany({}), prisma.game.deleteMany({})]);
}

export async function debugExportTrueState(gameId: string): Promise<unknown> {
  if (process.env.ENABLE_DEBUG_EXPORT !== "true") {
    throw new Error("Debug export disabled");
  }
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error("Game not found");
  const turns = await prisma.turnLog.findMany({ where: { gameId }, orderBy: { turnNumber: "asc" } });
  return {
    game: {
      id: game.id,
      seed: game.seed,
      status: game.status,
      currentTurn: game.currentTurn,
      playerCountryName: game.playerCountryName,
    },
    worldState: game.worldState,
    turns: turns.map((t) => ({
      turnNumber: t.turnNumber,
      briefingText: t.briefingText,
      incomingEvents: t.incomingEvents,
      playerActions: t.playerActions,
      publicResolution: t.publicResolution,
      worldState: t.worldState,
      failure: t.failure,
    })),
  };
}

export async function getTurnHistory(gameId: string): Promise<{
  turns: Array<{ turn: number; snapshot: GameSnapshot }>;
}> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error("Game not found");

  const rows = await prisma.turnLog.findMany({
    where: { gameId },
    orderBy: { turnNumber: "asc" },
  });

  const byTurn = new Map<number, GameSnapshot>();
  for (const r of rows) {
    const snap = r.playerSnapshot as unknown as GameSnapshot;
    byTurn.set(snap.turn, snap);
  }

  const latest = game.lastPlayerSnapshot as unknown as GameSnapshot;
  byTurn.set(latest.turn, latest);

  const turns = Array.from(byTurn.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([turn, snapshot]) => ({ turn, snapshot }));

  return { turns };
}

async function fillFailureTimeline(
  gameId: string,
  failure: NonNullable<TurnOutcome["failure"]>,
): Promise<NonNullable<TurnOutcome["failure"]>> {
  const last = await prisma.turnLog.findMany({
    where: { gameId },
    orderBy: { turnNumber: "desc" },
    take: 3,
  });
  return {
    ...failure,
    lastTurns: last
      .reverse()
      .map((t) => ({
        turn: t.turnNumber,
        headline: extractHeadline(t.publicConsequences),
        resolution: t.publicResolution,
      })),
  };
}

function extractHeadline(publicConsequences: unknown): string {
  if (Array.isArray(publicConsequences) && publicConsequences.length > 0) {
    const h = publicConsequences[0];
    if (typeof h === "string") return h;
  }
  return "—";
}

