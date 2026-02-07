import { prisma } from "./client";
import { buildCountryProfile, PlayerActionSchema, type GameSnapshot, type PlayerAction, type TurnOutcome, type WorldState } from "@/engine";
import { createNewGameWorld, getPlayerSnapshot, submitTurnAndAdvance } from "@/engine";
import {
  llmGenerateControlRoomView,
  llmGenerateCountryProfile,
  llmGenerateResolution,
  llmGenerateWorldGenScenario,
  llmGenerateTurnPackage,
  llmMode,
  llmParsePlayerDirective,
} from "./llm";
import { ensureDbSchema } from "./ensureDb";

function extractAfterSnapshot(playerSnapshot: unknown): GameSnapshot | null {
  if (!playerSnapshot || typeof playerSnapshot !== "object") return null;
  if ("after" in playerSnapshot) {
    const after = (playerSnapshot as { after?: unknown }).after;
    if (after && typeof after === "object" && "turn" in after) return after as GameSnapshot;
  }
  if ("turn" in (playerSnapshot as object)) return playerSnapshot as GameSnapshot;
  return null;
}

function extractBeforeSnapshot(playerSnapshot: unknown): GameSnapshot | null {
  if (!playerSnapshot || typeof playerSnapshot !== "object") return null;
  if ("before" in playerSnapshot) {
    const before = (playerSnapshot as { before?: unknown }).before;
    if (before && typeof before === "object" && "turn" in before) return before as GameSnapshot;
  }
  return null;
}

function extractAfterWorld(worldState: unknown): WorldState | null {
  if (!worldState || typeof worldState !== "object") return null;
  if ("after" in worldState) {
    const after = (worldState as { after?: unknown }).after;
    if (after && typeof after === "object" && "turn" in after) return after as WorldState;
  }
  if ("turn" in (worldState as object)) return worldState as WorldState;
  return null;
}

function extractBeforeWorld(worldState: unknown): WorldState | null {
  if (!worldState || typeof worldState !== "object") return null;
  if ("before" in worldState) {
    const before = (worldState as { before?: unknown }).before;
    if (before && typeof before === "object" && "turn" in before) return before as WorldState;
  }
  return null;
}

function pickPressureActor(world: WorldState) {
  const actorList = Object.values(world.actors);
  actorList.sort((a, b) => {
    const aScore =
      (a.postureTowardPlayer === "hostile" ? 2 : a.postureTowardPlayer === "neutral" ? 1 : 0) * 100 +
      (100 - a.trust) +
      a.domesticPressure +
      a.willingnessToEscalate;
    const bScore =
      (b.postureTowardPlayer === "hostile" ? 2 : b.postureTowardPlayer === "neutral" ? 1 : 0) * 100 +
      (100 - b.trust) +
      b.domesticPressure +
      b.willingnessToEscalate;
    return bScore - aScore;
  });
  return actorList[0]!;
}

function normalizePlaceLabel(s: string): string {
  const cleaned = s
    .replace(/["'’]/g, "")
    .replace(/\b(the|a|an)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Title-case lightly for UI readability; keep acronyms as-is.
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.toUpperCase() === w ? w : w.slice(0, 1).toUpperCase() + w.slice(1)))
    .join(" ");
}

function extractTargetRegionFromDirective(directive: string): string | null {
  // Heuristic: capture the immediate named object after common coercive verbs.
  // Examples:
  // - "attack nigeria and conquer it" -> "Nigeria"
  // - "invade turkey; take the capital" -> "Turkey"
  const m =
    directive.match(/\b(invade|attack|strike|bomb|conquer|occupy|seize|annex|take over)\s+([^.,;\n]+)$/i) ??
    directive.match(/\b(invade|attack|strike|bomb|conquer|occupy|seize|annex|take over)\s+([^.,;\n]+?)(?:\band\b|\bthen\b|\bwith\b|,|;|\.|\n|$)/i);
  if (!m) return null;
  const raw = String(m[2] ?? "").trim();
  if (!raw) return null;
  // Avoid capturing pronouns.
  if (/^(it|them|him|her|this|that)\b/i.test(raw)) return null;
  return normalizePlaceLabel(raw);
}

function pickTargetActorFromDirective(directive: string, world: WorldState) {
  const d = directive.toLowerCase();
  // Try to match explicit actor names mentioned by the user (e.g., "turkey").
  const entries = Object.entries(world.actors) as Array<[keyof typeof world.actors, (typeof world.actors)[keyof typeof world.actors]]>;
  for (const [id, actor] of entries) {
    const name = actor.name.toLowerCase();
    const tokens = name.split(/\s+/).filter(Boolean);
    if (tokens.some((t) => t.length >= 4 && d.includes(t))) return id;
    if (d.includes(name)) return id;
  }

  // If the directive looks like a kinetic action against a place we don't model as an actor,
  // don't default to a major power (US/CHINA/RUSSIA/EU). Use a generic regional actor instead.
  const wantsKinetic = /\b(invade|attack|strike|bomb|conquer|occupy|seize|annex|war)\b/.test(d);
  if (wantsKinetic && extractTargetRegionFromDirective(directive)) return "REGIONAL_1";

  return pickPressureActor(world).id;
}

function fallbackActionsFromDirective(args: {
  directive: string;
  world: WorldState;
  remainingSlots: number;
}): { actions: PlayerAction[]; rationale: string[] } {
  const d = args.directive.toLowerCase();
  const actions: PlayerAction[] = [];
  const rationale: string[] = [];
  const targetActorId = pickTargetActorFromDirective(args.directive, args.world);
  const targetRegion = extractTargetRegionFromDirective(args.directive) ?? undefined;

  const isPublic = /\bpublic\b|\bannounce\b|\bon tv\b|\bpress\b/.test(d);
  const intensity = /\bfull\b|\bmaximum\b|\bmassive\b|\bcrush\b|\binvade\b/.test(d) ? 3 : /\blimited\b|\bquiet\b|\bcovert\b/.test(d) ? 1 : 2;

  const wantAlliance =
    /\balliance\b|\bbloc\b|\bpact\b|\btreaty\b|\bmutual defense\b|\bcollective security\b|\bsecurity guarantee\b/.test(d) &&
    !/\banti-?alliance\b|\bbreak alliance\b/.test(d);

  const wantIndustry = /\binfrastructure\b|\bindustry\b|\bindustrial\b|\bfactory\b|\binvest\b|\bbuild\b/.test(d);
  const wantSubsidy = /\bsubsid(y|ies)\b|\bprice cap\b|\bfuel\b|\bfood\b/.test(d);
  const wantAusterity = /\bausterity\b|\bcut spending\b|\btighten\b/.test(d);
  const wantAttack = /\battack\b|\bstrike\b|\bbomb\b|\binvade\b|\bannex\b|\bwar\b/.test(d);
  const wantConquest = /\bconquer\b|\boccupy\b|\btake over\b|\bseize\b|\bannex\b|\binvade\b/.test(d);
  const wantMobilize = /\bmobiliz(e|ation)\b|\btroops\b|\bdeploy\b|\bposture\b/.test(d);
  const wantIntel = /\bintel\b|\bspy\b|\bsurveillance\b|\bcounterintel\b|\bcovert\b/.test(d);
  const wantNarrative = /\bpropaganda\b|\bnarrative\b|\bmedia\b|\bcensor\b/.test(d);
  const wantReform = /\banti-corruption\b|\breform\b|\bpurge\b|\belection\b/.test(d);

  if (wantIndustry && actions.length < args.remainingSlots) {
    actions.push({ kind: "ECONOMY", subkind: "INDUSTRIAL_PUSH", intensity, isPublic });
    rationale.push("Translate infrastructure/industry intent into an industrial push.");
  }
  if (wantAlliance && actions.length < args.remainingSlots) {
    const topic = /\btrade\b|\beconomic\b|\bmarket\b/.test(d) ? "trade" : "security";
    actions.push({
      kind: "DIPLOMACY",
      subkind: "TREATY_PROPOSAL",
      targetActor: targetActorId,
      topic,
      tone: "conciliatory",
      intensity,
      isPublic: isPublic || /\bpublicly\b|\bannounce\b/.test(d),
    });
    rationale.push("Translate alliance/bloc intent into a treaty proposal to the closest modeled partner/pressure actor.");
    if (actions.length < args.remainingSlots) {
      actions.push({
        kind: "DIPLOMACY",
        subkind: "MESSAGE",
        targetActor: targetActorId === "REGIONAL_1" ? "REGIONAL_2" : "REGIONAL_1",
        topic,
        tone: "firm",
        intensity: Math.max(1, intensity - 1) as 1 | 2 | 3,
        isPublic: false,
      });
      rationale.push("Add a second diplomatic channel to simulate multilateral coordination within the action budget.");
    }
  }
  if (wantSubsidy && actions.length < args.remainingSlots) {
    actions.push({ kind: "ECONOMY", subkind: "SUBSIDIES", intensity: Math.min(3, intensity + 0) as 1 | 2 | 3, isPublic: true });
    rationale.push("Translate price-stability intent into targeted subsidies.");
  }
  if (wantAusterity && actions.length < args.remainingSlots) {
    actions.push({ kind: "ECONOMY", subkind: "AUSTERITY", intensity: Math.max(1, intensity - 1) as 1 | 2 | 3, isPublic: true });
    rationale.push("Translate fiscal intent into controlled austerity.");
  }
  if ((wantAttack || wantMobilize) && actions.length < args.remainingSlots) {
    actions.push({
      kind: "MILITARY",
      subkind: wantAttack ? (wantConquest ? "FULL_INVASION" : "LIMITED_STRIKE") : "MOBILIZE",
      intensity: wantAttack && wantConquest ? (Math.max(intensity, 2) as 1 | 2 | 3) : intensity,
      isPublic,
      targetActor: targetActorId,
      targetRegion: targetRegion ?? (wantAttack && wantConquest ? "capital corridor" : "border zone"),
    });
    rationale.push(
      wantAttack && wantConquest
        ? "Translate conquest intent into a full invasion (high-risk, high-cost)."
        : "Translate coercive intent into a bounded military operation.",
    );
  }
  if (wantIntel && actions.length < args.remainingSlots) {
    actions.push({
      kind: "INTEL",
      subkind: "SURVEILLANCE",
      intensity: Math.min(3, intensity + 0) as 1 | 2 | 3,
      isPublic: false,
      targetActor: targetActorId,
    });
    rationale.push("Translate intelligence intent into surveillance to reduce deception risk.");
  }
  if (wantNarrative && actions.length < args.remainingSlots) {
    actions.push({ kind: "MEDIA", subkind: "NARRATIVE_FRAMING", intensity: Math.max(1, intensity - 0) as 1 | 2 | 3, isPublic: true });
    rationale.push("Translate narrative intent into disciplined framing.");
  }
  if (wantReform && actions.length < args.remainingSlots) {
    actions.push({ kind: "INSTITUTIONS", subkind: "ANTI_CORRUPTION_DRIVE", intensity: Math.max(1, intensity - 0) as 1 | 2 | 3, isPublic: true });
    rationale.push("Translate reform intent into an anti-corruption drive.");
  }

  if (actions.length === 0) {
    actions.push({
      kind: "DIPLOMACY",
      subkind: "MESSAGE",
      targetActor: targetActorId,
      topic: "sanctions",
      tone: "firm",
      intensity: 2,
      isPublic: false,
    });
    rationale.push("Default: send a quiet diplomatic message to the most relevant pressure actor.");
  }

  return { actions: actions.slice(0, args.remainingSlots), rationale };
}

async function attachControlRoomView(gameId: string, world: WorldState, snapshot: GameSnapshot): Promise<void> {
  if (llmMode() !== "ON") return;
  try {
    const recent = await prisma.turnLog.findMany({
      where: { gameId },
      orderBy: { turnNumber: "desc" },
      take: 3,
    });

    const memory = recent
      .map((r) => {
        const snapAfter = extractAfterSnapshot(r.playerSnapshot);
        const artifacts = (r.llmArtifacts as unknown as Record<string, unknown> | null) ?? null;
        const resolution = artifacts && typeof artifacts === "object" ? (artifacts as Record<string, unknown>)["resolution"] : null;
        const resolutionHeadline =
          resolution &&
          typeof resolution === "object" &&
          "headline" in resolution &&
          typeof (resolution as Record<string, unknown>).headline === "string"
            ? String((resolution as Record<string, unknown>).headline)
            : undefined;
        return {
          turn: r.turnNumber,
          resolutionHeadline,
          controlRoom: snapAfter?.playerView?.controlRoom ?? null,
        };
      })
      .reverse();

    const out = await llmGenerateControlRoomView({ snapshot, world, memory });
    snapshot.playerView.controlRoom = out.data as unknown as GameSnapshot["playerView"]["controlRoom"];
  } catch {
    // Ignore: UI will fall back to deterministic derivations.
  }
}

function newSeed(): string {
  // Deterministic engine requires a seed; generation of a *new* seed can be non-deterministic.
  return `seed-${crypto.randomUUID()}`;
}

function worldgenEnabled(): boolean {
  // Default ON when AI is available; disable with TWUO_LLM_WORLDGEN=false.
  if (process.env.TWUO_LLM_WORLDGEN === "false") return false;
  return true;
}

function seedToUnit(seed: string, salt: string): number {
  // Deterministic 0..1 derived from seed string; avoids pulling engine RNG helpers into db layer.
  let h = 2166136261 >>> 0;
  const s = `${salt}:${seed}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
}

function candidateGeoPoints(seed: string, n: number): Array<{ lat: number; lon: number }> {
  // Uniform-ish on lat/lon (not equal-area, but good enough for variety); keep within plausible inhabited range.
  const pts: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < n; i++) {
    const u1 = seedToUnit(seed, `lat:${i}`);
    const u2 = seedToUnit(seed, `lon:${i}`);
    const lat = -55 + u1 * (70 - -55); // [-55, 70]
    const lon = -180 + u2 * 360; // [-180, 180)
    pts.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
  }
  return pts;
}

function fastMode(): boolean {
  // Default fast in dev to avoid massive latency/credit burn while iterating.
  // Opt out by setting TWUO_FAST_MODE=false explicitly.
  if (process.env.TWUO_FAST_MODE === "false") return false;
  if (process.env.TWUO_FAST_MODE === "true") return true;
  return process.env.NODE_ENV !== "production";
}

export async function createGame(seed?: string): Promise<GameSnapshot> {
  await ensureDbSchema();
  const s = seed?.trim() ? seed.trim() : newSeed();
  const world = createNewGameWorld(s);

  // Optional LLM worldgen: remove hard-coded starting templates by patching the initial world’s
  // player identity + neighbors + regional powers based on a random global location.
  if (worldgenEnabled() && !fastMode() && llmMode() === "ON") {
    try {
      const candidates = candidateGeoPoints(s, 7);
      const gen = await llmGenerateWorldGenScenario({ seedHint: s.slice(0, 24), candidateLocations: candidates });
      world.player.name = gen.data.player.name;
      world.player.geographySummary = gen.data.player.geographySummary;
      world.player.neighbors = gen.data.player.neighbors;
      world.player.regimeType = gen.data.player.regimeType;
      // Patch regional actors' display names so the simulation "feels" local anywhere on Earth.
      world.actors.REGIONAL_1.name = gen.data.regionalPowers[0];
      world.actors.REGIONAL_2.name = gen.data.regionalPowers[1];
    } catch {
      // Fail closed: keep deterministic scenario templates.
    }
  }

  // Optional LLM generation for Turn 1 briefing/events (replaces deterministic turn-start content).
  let llmArtifact: unknown | undefined;
  if (!fastMode() && llmMode() === "ON") {
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
  if (!fastMode() && llmMode() === "ON") {
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

  // Optional LLM-generated control-room view model for this turn.
  if (!fastMode()) {
    await attachControlRoomView(game.id, world, snapshot);
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
        playerSnapshot: { before: snapshot, after: snapshot } as unknown as object,
        worldState: { before: world, after: world } as unknown as object,
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

  // Backfill control-room view (LLM-first) so UI uses LLM for Pressure/Hotspots/Signals/Feed immediately.
  if (!fastMode() && llmMode() === "ON" && !snap.playerView.controlRoom) {
    const world = game.worldState as unknown as WorldState;
    await attachControlRoomView(game.id, world, snap);
    await prisma.game.update({
      where: { id: game.id },
      data: { lastPlayerSnapshot: snap as unknown as object },
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

  // Backfill control-room view (LLM-first) so existing games render from LLM without requiring a new turn.
  if (!fastMode() && snapshot.llmMode === "ON" && !snapshot.playerView.controlRoom) {
    const world = game.worldState as unknown as WorldState;
    await attachControlRoomView(gameId, world, snapshot);
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
  // The engine mutates `world` in place. Capture an immutable before-state for logging and resolution diffs.
  const worldBefore = structuredClone(world) as WorldState;
  const snapshotBefore = getPlayerSnapshot(gameId, worldBefore, "ACTIVE");
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
        const fallback = fallbackActionsFromDirective({ directive: playerDirective.trim(), world, remainingSlots: remaining });
        actions = [...actions, ...fallback.actions].slice(0, 2);
        directiveArtifact = {
          error: "LLM directive parse failed; used fallback mapping.",
          fallbackActions: fallback.actions,
          fallbackRationale: fallback.rationale,
        };
      }
    }
  }

  // If AI is OFF, still map freeform directives into actions (fallback).
  if (playerDirective?.trim() && llmMode() === "OFF") {
    const remaining = Math.max(0, 2 - actions.length);
    if (remaining > 0) {
      const fallback = fallbackActionsFromDirective({ directive: playerDirective.trim(), world, remainingSlots: remaining });
      actions = [...actions, ...fallback.actions].slice(0, 2);
      directiveArtifact = { offlineFallback: true, fallbackActions: fallback.actions, fallbackRationale: fallback.rationale };
    }
  }

  // Post-process action targets so we don't falsely claim the player attacked a major power
  // when they named an unmodeled country/region (e.g., "attack Nigeria").
  if (playerDirective?.trim()) {
    const directive = playerDirective.trim();
    const dLower = directive.toLowerCase();
    const targetRegion = extractTargetRegionFromDirective(directive);
    for (const a of actions) {
      if (a.kind !== "MILITARY") continue;
      if (!targetRegion) continue;
      const major: Array<NonNullable<typeof a.targetActor>> = ["US", "CHINA", "RUSSIA", "EU"];
      if (!a.targetActor || !major.includes(a.targetActor)) {
        if (!a.targetRegion) a.targetRegion = targetRegion;
        continue;
      }
      // Only keep a major-power target if the directive explicitly mentions it.
      const actorName =
        a.targetActor === "US"
          ? "united states"
          : a.targetActor === "EU"
            ? "european union"
            : a.targetActor.toLowerCase();
      const mentionsMajor = dLower.includes(actorName) || dLower.includes(a.targetActor.toLowerCase());
      if (!mentionsMajor) {
        a.targetActor = "REGIONAL_1";
        if (!a.targetRegion) a.targetRegion = targetRegion;
      }
    }
  }

  const { world: nextWorld, outcome } = submitTurnAndAdvance(gameId, world, actions);

  // Optional LLM generation for next turn's briefing/events (replaces deterministic turn-start content).
  let llmArtifact: unknown | undefined;
  if (!fastMode() && !outcome.failure && llmMode() === "ON") {
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
  if (!fastMode() && llmMode() === "ON") {
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

  // Optional LLM-generated control-room view model for the *next* snapshot.
  if (!fastMode()) {
    await attachControlRoomView(gameId, nextWorld, finalOutcome.nextSnapshot);
  }

  // Stamp runtime AI mode into the returned snapshot so the client can correctly
  // decide whether to auto-enhance resolution, show AI indicators, etc.
  finalOutcome.nextSnapshot.llmMode = llmMode();

  // Capture after-state for logging. Must be cloned because `nextWorld` continues to be mutated (LLM turn package, etc.)
  const worldAfter = structuredClone(nextWorld) as WorldState;
  const snapshotAfter = structuredClone(finalOutcome.nextSnapshot) as GameSnapshot;

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
        playerSnapshot: { before: snapshotBefore, after: snapshotAfter } as unknown as object,
        worldState: { before: worldBefore, after: worldAfter } as unknown as object,
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
  await ensureDbSchema();
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
    const snap = extractAfterSnapshot(r.playerSnapshot);
    if (snap) byTurn.set(snap.turn, snap);
  }

  const latest = game.lastPlayerSnapshot as unknown as GameSnapshot;
  byTurn.set(latest.turn, latest);

  const turns = Array.from(byTurn.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([turn, snapshot]) => ({ turn, snapshot }));

  return { turns };
}

export async function getGameTimeline(
  gameId: string,
  opts?: { limit?: number },
): Promise<{
  items: Array<{
    turnNumber: number;
    directive: string | null;
    headline: string;
    bullets: string[];
    incoming: string[];
  }>;
}> {
  const limit = Math.max(3, Math.min(12, opts?.limit ?? 8));
  const rows = await prisma.turnLog.findMany({
    where: { gameId },
    orderBy: { turnNumber: "desc" },
    take: limit,
  });

  const safeStr = (v: unknown, max = 220) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const isTimeBlock = (s: string) =>
    s.startsWith("NEXT 72 HOURS:") || s.startsWith("2–4 WEEKS:") || s.startsWith("2–3 MONTHS:") || s.startsWith("4–6 MONTHS:");

  const items = rows
    .map((r) => {
      const snap = extractAfterSnapshot(r.playerSnapshot);
      const artifacts = (r.llmArtifacts as unknown as Record<string, unknown> | null) ?? null;
      const res = artifacts && typeof artifacts === "object" ? (artifacts as Record<string, unknown>)["resolution"] : null;
      const llmHeadline =
        res && typeof res === "object" && "headline" in (res as Record<string, unknown>)
          ? safeStr((res as Record<string, unknown>)["headline"], 160)
          : "";
      const llmNarr =
        res && typeof res === "object" && Array.isArray((res as Record<string, unknown>)["narrative"])
          ? ((res as Record<string, unknown>)["narrative"] as unknown[])
              .filter((x) => typeof x === "string")
              .map((s) => safeStr(s, 220))
              .filter(Boolean)
          : [];

      const publicHeadline = safeStr(r.publicResolution.split("\n")[0] ?? "", 160) || safeStr(r.publicResolution, 160);
      const headline = llmHeadline || publicHeadline || `Turn ${r.turnNumber}`;

      let bullets: string[] = [];
      if (llmNarr.length) {
        bullets = llmNarr.filter((s) => !isTimeBlock(s)).slice(0, 4);
      }
      if (!bullets.length && Array.isArray(r.publicConsequences)) {
        bullets = (r.publicConsequences as unknown[])
          .filter((x) => typeof x === "string")
          .map((s) => safeStr(s, 180))
          .filter(Boolean)
          .slice(0, 4);
      }
      if (!bullets.length) {
        bullets = safeStr(r.publicResolution, 800)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 4);
      }

      const incoming = (snap?.playerView?.incomingEvents ?? [])
        .slice(0, 5)
        .map((e) => (e && typeof e === "object" && "visibleDescription" in e ? String((e as { visibleDescription?: unknown }).visibleDescription) : ""))
        .map((s) => s.trim())
        .filter(Boolean);
      const directive = typeof r.playerDirective === "string" ? r.playerDirective : null;

      return {
        turnNumber: r.turnNumber,
        directive: directive?.trim() ? directive.trim() : null,
        headline,
        bullets,
        incoming,
      };
    })
    .filter(Boolean);

  return { items };
}

function summarizeAction(a: PlayerAction): string {
  const kind = a.kind;
  switch (kind) {
    case "DIPLOMACY":
      return `${a.subkind} to ${a.targetActor} (${a.tone}, ${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
    case "ECONOMY":
      return `${a.subkind} (${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
    case "MILITARY":
      return `${a.subkind}${
        a.targetRegion ? ` in ${a.targetRegion}` : a.targetActor ? ` vs ${a.targetActor}` : ""
      } (${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
    case "INTEL":
      return `${a.subkind}${a.targetActor ? ` targeting ${a.targetActor}` : ""} (${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
    case "MEDIA":
      return `${a.subkind} (${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
    case "INSTITUTIONS":
      return `${a.subkind} (${a.isPublic ? "public" : "private"}, intensity ${a.intensity})`;
  }
  return kind;
}

export async function getResolutionReport(
  gameId: string,
  turnNumber: number,
  opts?: { forceLlm?: boolean },
): Promise<{
  turnNumber: number;
  directive: string | null;
  translatedActions: Array<{ kind: string; summary: string }>;
  publicResolution: string;
  consequences: string[];
  signalsUnknown: string[];
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  directiveParseNotes?: string[];
  llm?: unknown;
}> {
  await ensureDbSchema();
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error("Game not found");

  const row = await prisma.turnLog.findFirst({ where: { gameId, turnNumber } });
  if (!row) throw new Error("Turn log not found");
  const prev = await prisma.turnLog.findFirst({ where: { gameId, turnNumber: turnNumber - 1 } });

  const afterWorld = extractAfterWorld(row.worldState) ?? (row.worldState as unknown as WorldState);
  const beforeWorld =
    extractBeforeWorld(row.worldState) ??
    (prev ? extractAfterWorld(prev.worldState) : null) ??
    afterWorld;

  const afterSnap = extractAfterSnapshot(row.playerSnapshot) ?? (row.playerSnapshot as unknown as GameSnapshot);
  const beforeSnap =
    extractBeforeSnapshot(row.playerSnapshot) ??
    (prev ? extractAfterSnapshot(prev.playerSnapshot) : null) ??
    afterSnap;

  const metric = (label: string, before: number, after: number) => {
    // WorldState numbers can be fractional (scenario formulas use weights). For player-facing
    // reporting, we present clean integers to avoid float artifacts like -20.999999999999996.
    const b = Math.round(before);
    const a = Math.round(after);
    return { label, before: b, after: a, delta: a - b };
  };

  const deltas = [
    metric("Legitimacy", beforeWorld.player.politics.legitimacy, afterWorld.player.politics.legitimacy),
    metric("Elite cohesion", beforeWorld.player.politics.eliteCohesion, afterWorld.player.politics.eliteCohesion),
    metric("Military loyalty", beforeWorld.player.politics.militaryLoyalty, afterWorld.player.politics.militaryLoyalty),
    metric("Unrest", beforeWorld.player.politics.unrest, afterWorld.player.politics.unrest),
    metric("Sovereignty integrity", beforeWorld.player.politics.sovereigntyIntegrity, afterWorld.player.politics.sovereigntyIntegrity),
    metric("Global credibility", beforeWorld.player.politics.credibilityGlobal, afterWorld.player.politics.credibilityGlobal),
    metric("Economic stability", beforeWorld.player.economy.economicStability, afterWorld.player.economy.economicStability),
    metric("Inflation pressure", beforeWorld.player.economy.inflationPressure, afterWorld.player.economy.inflationPressure),
    metric("Debt stress", beforeWorld.player.economy.debtStress, afterWorld.player.economy.debtStress),
    metric("Military readiness", beforeWorld.player.military.readiness, afterWorld.player.military.readiness),
  ];

  const actorIds = Object.keys(afterWorld.actors) as Array<keyof typeof afterWorld.actors>;
  const actorShifts = actorIds
    .map((id) => {
      const b = beforeWorld.actors[id];
      const a = afterWorld.actors[id];
      return {
        actor: a.name,
        posture: a.postureTowardPlayer,
        trustDelta: a.trust - b.trust,
        escalationDelta: a.willingnessToEscalate - b.willingnessToEscalate,
      };
    })
    .sort((x, y) => Math.abs(y.trustDelta) + Math.abs(y.escalationDelta) - (Math.abs(x.trustDelta) + Math.abs(x.escalationDelta)))
    .slice(0, 6);

  const threats = actorIds
    .map((id) => afterWorld.actors[id])
    .map((a) => ({
      name: a.name,
      score:
        (a.postureTowardPlayer === "hostile" ? 50 : a.postureTowardPlayer === "neutral" ? 20 : 0) +
        (100 - a.trust) * 0.35 +
        a.willingnessToEscalate * 0.35 +
        a.domesticPressure * 0.2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((t) => `Pressure vector: ${t.name}`);

  const translatedActions = (row.playerActions as unknown as PlayerAction[]).map((a) => {
    const subkind = (a as unknown as { subkind?: unknown }).subkind;
    // For LLM consumption we want the most specific action label available.
    const kind = typeof subkind === "string" && subkind.trim() ? subkind.trim() : a.kind;
    return { kind, summary: summarizeAction(a) };
  });

  const base = {
    turnNumber,
    directive: row.playerDirective ?? null,
    translatedActions,
    publicResolution: row.publicResolution,
    consequences: (row.publicConsequences as unknown as string[]) ?? [],
    signalsUnknown: (row.signalsUnknown as unknown as string[]) ?? [],
    deltas,
    actorShifts,
    threats,
    directiveParseNotes:
      row.llmArtifacts && typeof row.llmArtifacts === "object"
        ? (() => {
            const notes: string[] = [];
            const art = row.llmArtifacts as unknown as Record<string, unknown>;
            const dp = art["directiveParse"];
            if (dp && typeof dp === "object") {
              if ("error" in (dp as Record<string, unknown>) && typeof (dp as Record<string, unknown>).error === "string") {
                notes.push(String((dp as Record<string, unknown>).error));
              }
              if ("offlineFallback" in (dp as Record<string, unknown>)) {
                notes.push("AI was offline; used fallback directive→actions mapping.");
              }
            }
            return notes.length ? notes : undefined;
          })()
        : undefined,
  };

  if (llmMode() !== "ON") return base;

  const artifacts = (row.llmArtifacts as unknown as Record<string, unknown> | null) ?? null;
  const existing =
    artifacts && typeof artifacts === "object" ? (artifacts as Record<string, unknown>)["resolution"] ?? null : null;
  // Only reuse cached LLM artifacts if they actually contain a usable narrative.
  // Old/partial cached shapes can have a headline but no narrative, which makes the UI look blank.
  if (!opts?.forceLlm && existing && typeof existing === "object") {
    const n = (existing as Record<string, unknown>)["narrative"];
    const lines = Array.isArray(n) ? n.filter((x) => typeof x === "string").map((s) => String(s).trim()).filter(Boolean) : [];
    const hasTimeline =
      lines.some((s) => s.startsWith("NEXT 72 HOURS:")) &&
      lines.some((s) => s.startsWith("2–4 WEEKS:")) &&
      lines.some((s) => s.startsWith("2–3 MONTHS:")) &&
      lines.some((s) => s.startsWith("4–6 MONTHS:"));
    const leaksInternalOps = lines.some((s) => /\b(LIMITED_STRIKE|FULL_INVASION|MOBILIZE|PROXY_SUPPORT|ARMS_PURCHASE|intensity)\b/i.test(s));
    const leaksScoreDeltas =
      lines.some((s) => /\b[+-]\d{1,3}\b/.test(s)) ||
      lines.some((s) => /\b\d{1,3}\s*(\/\s*100|points?|pts)\b/i.test(s)) ||
      lines.some((s) => /\b\d{1,3}\s*\/\s*100\b/.test(s));
    // Require the richer timeline format; otherwise regenerate.
    // Also require that the narrative does not leak internal action labels or numeric deltas.
    if (lines.length >= 10 && hasTimeline && !leaksInternalOps && !leaksScoreDeltas) {
      return { ...base, llm: existing };
    }
  }

  // Fast mode: don't block the resolution API on LLM generation unless explicitly forced.
  // The UI can render from deterministic `publicResolution` + deltas immediately.
  if (fastMode() && !opts?.forceLlm) return base;

  try {
    const llm = await llmGenerateResolution({
      turnNumber,
      directive: row.playerDirective ?? undefined,
      translatedActions,
      deltas,
      actorShifts,
      threats,
      worldBefore: beforeWorld,
      worldAfter: afterWorld,
    });

    await prisma.turnLog.update({
      where: { id: row.id },
      data: {
        llmArtifacts: {
          ...(artifacts && typeof artifacts === "object" ? artifacts : {}),
          resolution: llm.data,
          resolutionRaw: llm.llmRaw,
          beforeSnapshotTurn: beforeSnap.turn,
          afterSnapshotTurn: afterSnap.turn,
        } as unknown as object,
      },
    });

    return { ...base, llm: llm.data };
  } catch (e) {
    // If the user explicitly asked for AI, do not fail silently; surface the error to the client.
    if (opts?.forceLlm) throw e;
    return base;
  }
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

