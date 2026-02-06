import type { ScheduledConsequence, WorldState } from "./types";
import { applyEffect } from "./effects";
import { clamp100 } from "./math";
import { rngChance, rngInt } from "./rng";

export function applyScheduledConsequences(world: WorldState): { landed: string[] } {
  const now = world.turn;
  const due = world.scheduled.filter((c) => c.dueTurn <= now);
  world.scheduled = world.scheduled.filter((c) => c.dueTurn > now);

  const landed: string[] = [];

  for (const c of due) {
    landed.push(consequenceText(c));
    switch (c.kind) {
      case "SANCTIONS_BITE": {
        const severity = (c.payload as { severity?: number } | null)?.severity ?? 50;
        // Sanctions are probabilistic: may activate depending on posture/trust.
        if (!world.global.sanctionsRegimeActive && rngChance(world.rng, clamp100(severity) / 120)) {
          world.global.sanctionsRegimeActive = true;
          applyEffect(world, {
            kind: "DELTA",
            key: "player.economy.economicStability",
            amount: -Math.round(severity * 0.18),
            reason: "Sanctions tighten financing and trade channels",
            visibility: "hidden",
          });
          applyEffect(world, {
            kind: "DELTA",
            key: "player.economy.inflationPressure",
            amount: +Math.round(severity * 0.12),
            reason: "Import constraints and FX pressure",
            visibility: "hidden",
          });
          applyEffect(world, {
            kind: "DELTA",
            key: "player.politics.legitimacy",
            amount: -Math.round(severity * 0.08),
            reason: "Sanctions narrative damages competence image",
            visibility: "hidden",
          });
        }
        break;
      }
      case "WAR_FATIGUE": {
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.warSupport",
          amount: -rngInt(world.rng, 4, 10),
          reason: "Casualties and disruption accumulate",
          visibility: "hidden",
        });
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.publicApproval",
          amount: -rngInt(world.rng, 2, 6),
          reason: "War fatigue spills into approval",
          visibility: "hidden",
        });
        break;
      }
      case "INSURGENCY_SPIKE": {
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.unrest",
          amount: +rngInt(world.rng, 6, 14),
          reason: "Insurgent activity increases insecurity",
          visibility: "hidden",
        });
        break;
      }
      case "INFLATION_LAG": {
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.inflationPressure",
          amount: +rngInt(world.rng, 3, 10),
          reason: "Policy lag hits prices",
          visibility: "hidden",
        });
        break;
      }
      case "ELITE_SPLIT_RISK": {
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.eliteCohesion",
          amount: -rngInt(world.rng, 4, 10),
          reason: "Factional rivalry hardens",
          visibility: "hidden",
        });
        break;
      }
      case "INTEL_REVELATION": {
        // Revelation is handled indirectly via better next-turn intelQuality (simulated in snapshot).
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.credibilityGlobal",
          amount: +rngInt(world.rng, 1, 4),
          reason: "Belated clarity helps messaging",
          visibility: "hidden",
        });
        break;
      }
    }
  }

  return { landed };
}

function consequenceText(c: ScheduledConsequence): string {
  switch (c.kind) {
    case "SANCTIONS_BITE":
      return "Sanctions risk begins to translate into real financing and trade constraints.";
    case "WAR_FATIGUE":
      return "War fatigue deepens; casualty sensitivity rises and coalition discipline weakens.";
    case "INSURGENCY_SPIKE":
      return "Insurgent activity increases; security operations face higher political cost.";
    case "INFLATION_LAG":
      return "Policy lag pushes inflation higher than last week’s indicators suggested.";
    case "ELITE_SPLIT_RISK":
      return "Elite factionalism hardens; quiet defections become more likely.";
    case "INTEL_REVELATION":
      return "Delayed intelligence clarifies part of last turn’s ambiguity (not necessarily in your favor).";
  }
}

export function applyBaselineDrift(world: WorldState): { driftNotes: string[] } {
  const p = world.player;
  const notes: string[] = [];

  // Economy drift: debt + sanctions + mobilization costs reduce stability.
  const sanctionsPenalty = world.global.sanctionsRegimeActive ? 6 : 0;
  const stabilityDown = Math.round(2 + p.economy.debtStress * 0.03 + sanctionsPenalty + p.economy.inflationPressure * 0.02);
  p.economy.economicStability = clamp100(p.economy.economicStability - stabilityDown + rngInt(world.rng, -2, 2));
  if (stabilityDown >= 7) notes.push("Economic stability is eroding under debt and external constraints.");

  // Unrest responds to prices and stability.
  const unrestUp = Math.round(1 + (p.economy.inflationPressure - 40) * 0.05 + (55 - p.economy.economicStability) * 0.04);
  p.politics.unrest = clamp100(p.politics.unrest + unrestUp + rngInt(world.rng, -2, 3));

  // Legitimacy tends to drift down with unrest and corruption, up slightly with stability.
  const legitDelta = Math.round(
    -0.8 - p.politics.corruption * 0.01 - (p.politics.unrest - 40) * 0.02 + (p.economy.economicStability - 55) * 0.015,
  );
  p.politics.legitimacy = clamp100(p.politics.legitimacy + legitDelta + rngInt(world.rng, -1, 1));

  // Sovereignty integrity drifts down if attention is high and readiness is low.
  const sovDelta = Math.round(-0.5 - (world.global.attentionLevel - 50) * 0.02 + (p.military.readiness - 55) * 0.01);
  p.politics.sovereigntyIntegrity = clamp100(p.politics.sovereigntyIntegrity + sovDelta + rngInt(world.rng, -1, 1));

  // War drift: if in conflict, apply attrition and schedule fatigue.
  if (world.conflicts.length > 0) {
    for (const c of world.conflicts) {
      const baseAttr = 6 + c.escalationLevel * 3;
      const logisticsMitigation = (p.military.logistics - 50) * 0.04;
      const attr = clamp100(c.attrition + Math.max(2, Math.round(baseAttr - logisticsMitigation)) + rngInt(world.rng, -2, 3));
      c.attrition = attr;
      c.cumulativeCasualties += Math.round(attr * 0.12);
      c.civilianHarm = clamp100(c.civilianHarm + rngInt(world.rng, 2, 8) + c.escalationLevel);
      c.insurgencyRisk = clamp100(c.insurgencyRisk + rngInt(world.rng, 1, 6) + (c.occupationBurden > 50 ? 2 : 0));

      if (!world.scheduled.some((s) => s.kind === "WAR_FATIGUE" && s.dueTurn === world.turn + 1)) {
        world.scheduled.push({
          id: `T${world.turn}-SC-WAR_FATIGUE`,
          dueTurn: world.turn + 1,
          kind: "WAR_FATIGUE",
          payload: {},
        });
      }
    }
    // War costs hit economy.
    p.economy.economicStability = clamp100(p.economy.economicStability - rngInt(world.rng, 2, 6));
    p.economy.inflationPressure = clamp100(p.economy.inflationPressure + rngInt(world.rng, 1, 4));
    notes.push("War costs are compounding: attrition, inflation pressure, and attention are rising.");

    // Sovereignty degrades under war, especially if readiness/logistics are weak and escalation is high.
    const avgEsc = world.conflicts.reduce((a, c) => a + c.escalationLevel, 0) / world.conflicts.length;
    const avgAttr = world.conflicts.reduce((a, c) => a + c.attrition, 0) / world.conflicts.length;
    const weakness = clamp100(60 - (p.military.readiness + p.military.logistics) / 2) / 100;
    const sovHit = Math.round(2 + avgEsc * 1.2 + (avgAttr - 40) * 0.05 + weakness * 6);
    p.politics.sovereigntyIntegrity = clamp100(p.politics.sovereigntyIntegrity - sovHit + rngInt(world.rng, -1, 2));

    // Rare but decisive collapse: capital effectively lost under high escalation + low readiness.
    const collapseRisk = Math.max(0, (avgEsc - 3) * 0.12 + weakness * 0.18);
    if (!p.flags.capitalOccupied && rngChance(world.rng, collapseRisk)) {
      p.flags.capitalOccupied = true;
      p.politics.sovereigntyIntegrity = clamp100(Math.min(p.politics.sovereigntyIntegrity, 15));
      notes.push("Security situation deteriorated sharply. Central authority over the capital is no longer credible.");
    }
  }

  // Attention drifts with sanctions/war.
  const attentionDelta = (world.conflicts.length > 0 ? 6 : 1) + (world.global.sanctionsRegimeActive ? 3 : 0);
  world.global.attentionLevel = clamp100(world.global.attentionLevel + attentionDelta + rngInt(world.rng, -2, 2));

  return { driftNotes: notes };
}

