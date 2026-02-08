import type { GameSnapshot, PlayerAction, TurnOutcome, WorldState } from "./types";
import { createInitialWorld } from "./scenario";
import { applyEffect } from "./effects";
import { applyBaselineDrift, applyScheduledConsequences } from "./drift";
import { detectFailure } from "./failure";
import { resolveIncomingEvents, resolvePlayerActions } from "./resolve";
import { buildSnapshot } from "./snapshot";
import { generateBriefingAndEvents } from "./turnStart";

export const ENGINE_ACTION_LIMIT = 2;

export function createNewGameWorld(seed: string, opts?: { turnStartGenerator?: WorldState["turnStartGenerator"] }): WorldState {
  return createInitialWorld(seed, opts);
}

export function getPlayerSnapshot(gameId: string, world: WorldState, status: "ACTIVE" | "FAILED"): GameSnapshot {
  return buildSnapshot(gameId, world, status);
}

export function submitTurnAndAdvance(
  gameId: string,
  world: WorldState,
  actions: PlayerAction[],
): { world: WorldState; outcome: TurnOutcome } {
  if (actions.length > ENGINE_ACTION_LIMIT) {
    throw new Error(`Too many actions: limit is ${ENGINE_ACTION_LIMIT}`);
  }

  const turnResolved = world.turn;
  const events = world.current.incomingEvents;

  // 1) Resolve incoming events (hidden payload applies regardless of player actions).
  const eventRes = resolveIncomingEvents(world, events);

  // 2) Resolve player actions.
  const actionRes = resolvePlayerActions(world, actions);

  // 3) Commit scheduled consequence queue.
  // IMPORTANT: both resolve functions start from a copy of world.scheduled,
  // so naively concatenating would duplicate every existing item. De-dupe by id.
  {
    const seen = new Set<string>();
    const merged: typeof world.scheduled = [];
    for (const item of [...eventRes.scheduled, ...actionRes.scheduled]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    world.scheduled = merged;
  }

  // 4) Apply public then hidden operations (ordering is deterministic).
  const publicOps = [...eventRes.publicOps, ...actionRes.publicOps];
  const hiddenOps = [...eventRes.hiddenOps, ...actionRes.hiddenOps];
  for (const op of publicOps) applyEffect(world, op);
  for (const op of hiddenOps) applyEffect(world, op);

  // 5) Apply delayed consequences and drift.
  const landed = applyScheduledConsequences(world);
  const drift = applyBaselineDrift(world);

  // 6) Detect failure.
  const failure = detectFailure(world);

  const consequences = [
    ...dedupe(eventRes.publicConsequences),
    ...dedupe(actionRes.publicConsequences),
    ...landed.landed,
    ...drift.driftNotes,
  ].slice(0, 10);

  const signalsUnknown = dedupe([...eventRes.signalsUnknown, ...actionRes.signalsUnknown]).slice(0, 6);

  const publicResolutionText = buildPublicResolutionText(turnResolved, consequences, signalsUnknown, failure);

  // 7) Advance to next turn context if not failed.
  let status: "ACTIVE" | "FAILED" = "ACTIVE";
  if (failure) {
    status = "FAILED";
  } else {
    world.turn += 1;
    if (world.turnStartGenerator === "llm") {
      // LLM-driven turn start: leave blank; db/llm layer will fill it.
      world.current.briefing = { text: "", headlines: [], domesticRumors: [], diplomaticMessages: [], intelBriefs: [] };
      world.current.incomingEvents = [];
    } else {
      const { briefing, events: nextEvents } = generateBriefingAndEvents(world, { forcePressureEvent: false });
      world.current.briefing = briefing;
      world.current.incomingEvents = nextEvents;
    }
  }

  const nextSnapshot = buildSnapshot(gameId, world, status);
  const outcome: TurnOutcome = {
    turnResolved,
    publicResolutionText,
    consequences,
    signalsUnknown,
    failure: failure ? { ...failure } : undefined,
    nextSnapshot,
  };

  return { world, outcome };
}

function buildPublicResolutionText(
  turn: number,
  consequences: string[],
  unknowns: string[],
  failure: ReturnType<typeof detectFailure> | undefined,
): string {
  const lines: string[] = [];
  lines.push(`TURN ${turn} // RESOLUTION`);
  lines.push("");
  lines.push("Public summary:");
  for (const c of consequences.slice(0, 6)) lines.push(`- ${c}`);
  lines.push("");
  lines.push("Signals & uncertainties:");
  for (const u of unknowns.slice(0, 3)) lines.push(`- ${u}`);
  if (failure) {
    lines.push("");
    lines.push(`FAILURE: ${failure.title.toUpperCase()}`);
    for (const d of failure.primaryDrivers) lines.push(`- ${d}`);
  }
  return lines.join("\n");
}

function dedupe(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const k = it.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

