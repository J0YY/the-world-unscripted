import type { Briefing, Confidence, WorldState } from "./types";
import { rngChance, rngPick } from "./rng";
import { intelQuality01 } from "./intel";

function confLabel(q: number): Confidence {
  if (q >= 0.7) return "high";
  if (q >= 0.45) return "med";
  return "low";
}

export function generateWorldBriefing(world: WorldState): Briefing {
  const q = intelQuality01(world);
  const intelConf = confLabel(q);

  const hostile = Object.values(world.actors).find((a) => a.postureTowardPlayer === "hostile");
  const pressureLine = hostile
    ? `${hostile.name} posture remains hardening; internal pressure on their side is trending up.`
    : "Major powers are watching but not coordinating; room exists for bilateral deals.";

  const warLine =
    world.conflicts.length > 0
      ? `Active conflict(s) ongoing; fog-of-war is increasing and civilian harm narratives are spreading.`
      : "No active war fronts, but border friction and procurement scrutiny are accumulating.";

  const econLine = `Inflation pressure is ${
    world.player.economy.inflationPressure >= 60
      ? "elevated"
      : world.player.economy.inflationPressure >= 45
        ? "rising"
        : "contained"
  }. Debt stress is ${world.player.economy.debtStress >= 60 ? "high" : "manageable"}; market tolerance is thin.`;

  const domesticLine =
    world.player.politics.unrest >= 60
      ? "Unrest indicators are high; local governors are reporting coordination across provinces."
      : world.player.politics.unrest >= 40
        ? "Unrest indicators are building; the weekend will be a test."
        : "Street conditions are stable, but rumor velocity is increasing.";

  const headlines = [
    `Markets: energy conditions appear ${bucket(world.global.globalEnergyMarketTightness)}; insurers are repricing regional risk.`,
    `Domestic: price controls are being discussed openly as inflation becomes a political issue.`,
    `Diplomacy: ${pressureLine}`,
  ];

  const domesticRumors = [
    rngPick(world.rng, [
      "Rumor mill: a cabinet reshuffle is being drafted to satisfy a key faction.",
      "Rumor mill: security services disagree on protest handling rules of engagement.",
      "Rumor mill: a major importer is hoarding staples ahead of a tariff decision.",
    ]),
    rngPick(world.rng, [
      "Rumor mill: a provincial commander is seeking guarantees before backing a crackdown order.",
      "Rumor mill: leaked procurement paperwork is circulating among journalists.",
      "Rumor mill: opposition figures are coordinating with diaspora fundraising networks.",
    ]),
  ];

  const diplomaticMessages: string[] = [];
  if (hostile) {
    diplomaticMessages.push(
      `${hostile.name}: “We expect measurable steps within days. Public messaging will reflect outcomes.”`,
    );
  } else {
    diplomaticMessages.push(`EU: “We can discuss a technical track if you reduce unpredictability in public statements.”`);
  }

  const intelBriefs: { text: string; confidence: Confidence }[] = [
    {
      text: rngPick(world.rng, [
        "Signals suggest sanction-design work is active in two capitals; timing depends on a triggering incident.",
        "Procurement networks are under scrutiny; a public interdiction may be staged to build coalition support.",
        "A border incident is likely to be amplified online regardless of attribution; escalation control will be difficult.",
      ]),
      confidence: intelConf,
    },
  ];

  if (rngChance(world.rng, 0.35 + 0.25 * (1 - q))) {
    // Occasionally add a contradictory or delayed intel brief.
    intelBriefs.push({
      text: rngPick(world.rng, [
        "Counter-signal: one channel reports a sanctions freeze is possible in exchange for inspection access (unverified).",
        "Counter-signal: an ally claims de-escalation is underway; evidence is thin and may be narrative management.",
      ]),
      confidence: q >= 0.6 ? "med" : "low",
    });
  }

  const text = [
    "CABINET BRIEF // INTERNAL",
    "",
    "1) International",
    `- ${pressureLine}`,
    `- Global attention is ${bucket(world.global.attentionLevel)}; trade conditions look ${bucket(world.global.globalTradeTemperature)}.`,
    "",
    "2) Domestic",
    `- ${domesticLine}`,
    `- Legitimacy stress is being driven by prices, corruption narratives, and elite signaling.`,
    "",
    "3) Security / War",
    `- ${warLine}`,
    `- Readiness is assessed as ${bucket(world.player.military.readiness)}; logistics capacity looks ${bucket(world.player.military.logistics)}.`,
    "",
    "4) Economy",
    `- ${econLine}`,
  ].join("\n");

  return { text, headlines, domesticRumors, diplomaticMessages, intelBriefs };
}

function bucket(v: number): string {
  if (v >= 75) return "high";
  if (v >= 55) return "moderate";
  if (v >= 35) return "low";
  return "critical";
}

