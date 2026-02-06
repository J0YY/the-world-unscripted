import { describe, expect, test } from "vitest";
import { createNewGameWorld, submitTurnAndAdvance } from "./engine";
import type { PlayerAction } from "./types";

describe("engine determinism (seeded)", () => {
  test("same seed + same actions => identical outcomes", () => {
    const seed = "determinism-seed-001";
    const w1 = createNewGameWorld(seed);
    const w2 = createNewGameWorld(seed);

    const actions: PlayerAction[] = [
      {
        kind: "ECONOMY",
        subkind: "SUBSIDIES",
        intensity: 2,
        isPublic: true,
      },
      {
        kind: "DIPLOMACY",
        subkind: "MESSAGE",
        targetActor: "EU",
        topic: "sanctions",
        tone: "conciliatory",
        intensity: 2,
        isPublic: false,
      },
    ];

    const r1 = submitTurnAndAdvance("g", w1, actions);
    const r2 = submitTurnAndAdvance("g", w2, actions);

    expect(r1.outcome.publicResolutionText).toEqual(r2.outcome.publicResolutionText);
    expect(r1.outcome.consequences).toEqual(r2.outcome.consequences);
    expect(r1.outcome.signalsUnknown).toEqual(r2.outcome.signalsUnknown);
    expect(r1.outcome.failure?.type ?? null).toEqual(r2.outcome.failure?.type ?? null);

    expect(JSON.stringify(r1.world)).toEqual(JSON.stringify(r2.world));
  });
});

