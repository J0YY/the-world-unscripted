import type { ScheduledConsequence, WorldState } from "./types";
import { applyEffect } from "./effects";
import { clamp100 } from "./math";
import { rngChance, rngInt } from "./rng";

export function applyScheduledConsequences(world: WorldState): { landed: string[] } {
  const now = world.turn;
  const due = world.scheduled.filter((c) => c.dueTurn <= now);
  world.scheduled = world.scheduled.filter((c) => c.dueTurn > now);

  const landed: string[] = [];

  // Cap how many ELITE_SPLIT_RISK events fire per turn to prevent cascading collapse.
  let eliteSplitCount = 0;
  const MAX_ELITE_SPLITS_PER_TURN = 2;

  for (const c of due) {
    switch (c.kind) {
      case "SANCTIONS_BITE": {
        landed.push(consequenceText(c));
        const severity = (c.payload as { severity?: number } | null)?.severity ?? 50;
        if (!world.global.sanctionsRegimeActive && rngChance(world.rng, clamp100(severity) / 120)) {
          world.global.sanctionsRegimeActive = true;
          applyEffect(world, {
            kind: "DELTA",
            key: "player.economy.economicStability",
            amount: -Math.round(severity * 0.14),
            reason: "Sanctions tighten financing and trade channels",
            visibility: "hidden",
          });
          applyEffect(world, {
            kind: "DELTA",
            key: "player.economy.inflationPressure",
            amount: +Math.round(severity * 0.10),
            reason: "Import constraints and FX pressure",
            visibility: "hidden",
          });
          applyEffect(world, {
            kind: "DELTA",
            key: "player.politics.legitimacy",
            amount: -Math.round(severity * 0.06),
            reason: "Sanctions narrative damages competence image",
            visibility: "hidden",
          });
        }
        break;
      }
      case "WAR_FATIGUE": {
        landed.push(consequenceText(c));
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.warSupport",
          amount: -rngInt(world.rng, 3, 7),
          reason: "Casualties and disruption accumulate",
          visibility: "hidden",
        });
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.publicApproval",
          amount: -rngInt(world.rng, 1, 4),
          reason: "War fatigue spills into approval",
          visibility: "hidden",
        });
        break;
      }
      case "INSURGENCY_SPIKE": {
        landed.push(consequenceText(c));
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.unrest",
          amount: +rngInt(world.rng, 4, 10),
          reason: "Insurgent activity increases insecurity",
          visibility: "hidden",
        });
        break;
      }
      case "INFLATION_LAG": {
        landed.push(consequenceText(c));
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.inflationPressure",
          amount: +rngInt(world.rng, 2, 6),
          reason: "Policy lag hits prices",
          visibility: "hidden",
        });
        break;
      }
      case "ELITE_SPLIT_RISK": {
        eliteSplitCount++;
        if (eliteSplitCount <= MAX_ELITE_SPLITS_PER_TURN) {
          landed.push(consequenceText(c));
          applyEffect(world, {
            kind: "DELTA",
            key: "player.politics.eliteCohesion",
            amount: -rngInt(world.rng, 3, 6),
            reason: "Factional rivalry hardens",
            visibility: "hidden",
          });
        }
        break;
      }
      case "INTEL_REVELATION": {
        landed.push(consequenceText(c));
        applyEffect(world, {
          kind: "DELTA",
          key: "player.politics.credibilityGlobal",
          amount: +rngInt(world.rng, 1, 4),
          reason: "Belated clarity helps messaging",
          visibility: "hidden",
        });
        break;
      }
      case "INFRASTRUCTURE_BENEFIT": {
        landed.push(consequenceText(c));
        const intensity = (c.payload as { intensity?: number } | null)?.intensity ?? 2;
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.economicStability",
          amount: +Math.round(2 + intensity * 1.5),
          reason: "Infrastructure investments begin yielding returns",
          visibility: "hidden",
        });
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.unemployment",
          amount: -Math.round(1 + intensity),
          reason: "Sustained industrial employment",
          visibility: "hidden",
        });
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.inflationPressure",
          amount: -Math.round(intensity),
          reason: "Improved supply chains reduce bottlenecks",
          visibility: "hidden",
        });
        break;
      }
      case "TRADE_DIVIDEND": {
        landed.push(consequenceText(c));
        const intensity = (c.payload as { intensity?: number } | null)?.intensity ?? 2;
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.economicStability",
          amount: +Math.round(1 + intensity),
          reason: "Trade flows generate revenue and diversify supply",
          visibility: "hidden",
        });
        applyEffect(world, {
          kind: "DELTA",
          key: "player.economy.inflationPressure",
          amount: -Math.round(intensity),
          reason: "Import access eases price pressures",
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
      return "Delayed intelligence clarifies part of last turn’s ambiguity (not necessarily in your favor).";    case "INFRASTRUCTURE_BENEFIT":
      return "Infrastructure investments are yielding tangible economic returns and employment.";
    case "TRADE_DIVIDEND":
      return "Trade agreements are generating revenue and diversifying supply chains.";  }
}

export function applyBaselineDrift(world: WorldState): { driftNotes: string[] } {
  const p = world.player;
  const notes: string[] = [];

  // Economy drift: debt + sanctions + inflation erode stability, but moderated
  // so that deliberate player actions can meaningfully counteract deterioration.
  const sanctionsPenalty = world.global.sanctionsRegimeActive ? 4 : 0;
  const rawStabilityDown = 1 + p.economy.debtStress * 0.02 + sanctionsPenalty + p.economy.inflationPressure * 0.015;
  // Dampen drift when stability is already critically low — prevents inescapable death spirals.
  const lowStabilityDamper = p.economy.economicStability < 30
    ? Math.max(0.4, p.economy.economicStability / 30)
    : 1;
  const stabilityDown = Math.round(rawStabilityDown * lowStabilityDamper);
  p.economy.economicStability = clamp100(p.economy.economicStability - stabilityDown + rngInt(world.rng, -1, 2));
  if (stabilityDown >= 5) notes.push("Economic stability is eroding under debt and external constraints.");

  // Unrest responds to prices and stability, but dampened.
  const rawUnrestUp = 0.5 + Math.max(0, (p.economy.inflationPressure - 45) * 0.04) + Math.max(0, (50 - p.economy.economicStability) * 0.03);
  p.politics.unrest = clamp100(p.politics.unrest + Math.round(rawUnrestUp) + rngInt(world.rng, -1, 2));

  // Legitimacy tends to drift down with unrest and corruption, up slightly with stability.
  // Reduced negative bias so player actions can keep legitimacy stable.
  const legitDelta = Math.round(
    -0.4 - p.politics.corruption * 0.008 - Math.max(0, (p.politics.unrest - 45) * 0.015) + Math.max(0, (p.economy.economicStability - 45) * 0.012),
  );
  p.politics.legitimacy = clamp100(p.politics.legitimacy + legitDelta + rngInt(world.rng, -1, 1));

  // Sovereignty integrity drifts down if attention is high and readiness is low.
  const sovDelta = Math.round(-0.3 - Math.max(0, (world.global.attentionLevel - 55) * 0.015) + Math.max(0, (p.military.readiness - 50) * 0.01));
  p.politics.sovereigntyIntegrity = clamp100(p.politics.sovereigntyIntegrity + sovDelta + rngInt(world.rng, -1, 1));

  // War drift: if in conflict, apply attrition and schedule fatigue.
  if (world.conflicts.length > 0) {
    for (const c of world.conflicts) {
      const baseAttr = 5 + c.escalationLevel * 2;
      const logisticsMitigation = (p.military.logistics - 50) * 0.04;
      const attr = clamp100(c.attrition + Math.max(1, Math.round(baseAttr - logisticsMitigation)) + rngInt(world.rng, -2, 2));
      c.attrition = attr;
      c.cumulativeCasualties += Math.round(attr * 0.10);
      c.civilianHarm = clamp100(c.civilianHarm + rngInt(world.rng, 1, 5) + c.escalationLevel);
      c.insurgencyRisk = clamp100(c.insurgencyRisk + rngInt(world.rng, 1, 4) + (c.occupationBurden > 50 ? 2 : 0));

      if (!world.scheduled.some((s) => s.kind === "WAR_FATIGUE" && s.dueTurn === world.turn + 1)) {
        world.scheduled.push({
          id: `T${world.turn}-SC-WAR_FATIGUE`,
          dueTurn: world.turn + 1,
          kind: "WAR_FATIGUE",
          payload: {},
        });
      }
    }
    // War costs hit economy (reduced so player economy actions still matter).
    p.economy.economicStability = clamp100(p.economy.economicStability - rngInt(world.rng, 1, 3));
    p.economy.inflationPressure = clamp100(p.economy.inflationPressure + rngInt(world.rng, 1, 2));
    notes.push("War costs are compounding: attrition, inflation pressure, and attention are rising.");

    // Sovereignty degrades under war, but at a manageable rate.
    const avgEsc = world.conflicts.reduce((a, c) => a + c.escalationLevel, 0) / world.conflicts.length;
    const avgAttr = world.conflicts.reduce((a, c) => a + c.attrition, 0) / world.conflicts.length;
    const weakness = clamp100(60 - (p.military.readiness + p.military.logistics) / 2) / 100;
    const sovHit = Math.round(1 + avgEsc * 0.8 + Math.max(0, (avgAttr - 40) * 0.04) + weakness * 4);
    p.politics.sovereigntyIntegrity = clamp100(p.politics.sovereigntyIntegrity - sovHit + rngInt(world.rng, -1, 2));

    // Rare but decisive collapse: capital effectively lost under high escalation + low readiness.
    const collapseRisk = Math.max(0, (avgEsc - 3) * 0.10 + weakness * 0.15);
    if (!p.flags.capitalOccupied && rngChance(world.rng, collapseRisk)) {
      p.flags.capitalOccupied = true;
      p.politics.sovereigntyIntegrity = clamp100(Math.min(p.politics.sovereigntyIntegrity, 15));
      notes.push("Security situation deteriorated sharply. Central authority over the capital is no longer credible.");
    }
  }

  // Attention drifts with sanctions/war (slightly reduced).
  const attentionDelta = (world.conflicts.length > 0 ? 4 : 1) + (world.global.sanctionsRegimeActive ? 2 : 0);
  world.global.attentionLevel = clamp100(world.global.attentionLevel + attentionDelta + rngInt(world.rng, -2, 2));

  return { driftNotes: notes };
}

