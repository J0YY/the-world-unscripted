import type { EffectOp, WorldState } from "./types";
import { clamp100 } from "./math";

export function applyEffect(world: WorldState, op: EffectOp): void {
  switch (op.kind) {
    case "DELTA": {
      const v = op.amount;
      switch (op.key) {
        case "player.politics.legitimacy":
          world.player.politics.legitimacy = clamp100(world.player.politics.legitimacy + v);
          return;
        case "player.politics.eliteCohesion":
          world.player.politics.eliteCohesion = clamp100(world.player.politics.eliteCohesion + v);
          return;
        case "player.politics.militaryLoyalty":
          world.player.politics.militaryLoyalty = clamp100(world.player.politics.militaryLoyalty + v);
          return;
        case "player.politics.publicApproval":
          world.player.politics.publicApproval = clamp100(world.player.politics.publicApproval + v);
          return;
        case "player.politics.mediaControl":
          world.player.politics.mediaControl = clamp100(world.player.politics.mediaControl + v);
          return;
        case "player.politics.corruption":
          world.player.politics.corruption = clamp100(world.player.politics.corruption + v);
          return;
        case "player.politics.warSupport":
          world.player.politics.warSupport = clamp100(world.player.politics.warSupport + v);
          return;
        case "player.politics.unrest":
          world.player.politics.unrest = clamp100(world.player.politics.unrest + v);
          return;
        case "player.politics.sovereigntyIntegrity":
          world.player.politics.sovereigntyIntegrity = clamp100(world.player.politics.sovereigntyIntegrity + v);
          return;
        case "player.politics.credibilityGlobal":
          world.player.politics.credibilityGlobal = clamp100(world.player.politics.credibilityGlobal + v);
          return;
        case "player.economy.economicStability":
          world.player.economy.economicStability = clamp100(world.player.economy.economicStability + v);
          return;
        case "player.economy.inflationPressure":
          world.player.economy.inflationPressure = clamp100(world.player.economy.inflationPressure + v);
          return;
        case "player.economy.unemployment":
          world.player.economy.unemployment = clamp100(world.player.economy.unemployment + v);
          return;
        case "player.economy.debtStress":
          world.player.economy.debtStress = clamp100(world.player.economy.debtStress + v);
          return;
        case "player.military.readiness":
          world.player.military.readiness = clamp100(world.player.military.readiness + v);
          return;
        case "global.attentionLevel":
          world.global.attentionLevel = clamp100(world.global.attentionLevel + v);
          return;
        default: {
          // Exhaustiveness guard
          throw new Error(`Unknown delta key: ${op.key}`);
        }
      }
    }
    case "DELTA_ACTOR": {
      const actor = world.actors[op.actorId];
      actor[op.field] = clamp100((actor[op.field] as number) + op.amount) as never;
      return;
    }
    case "SET_POSTURE": {
      world.actors[op.actorId].postureTowardPlayer = op.posture;
      return;
    }
    case "SET_SANCTIONS": {
      world.global.sanctionsRegimeActive = op.active;
      return;
    }
    case "START_CONFLICT": {
      if (!world.conflicts.some((c) => c.id === op.conflict.id)) world.conflicts.push(op.conflict);
      return;
    }
    case "SET_FLAG": {
      world.player.flags[op.flag] = op.value;
      return;
    }
  }
}

