import { rngChance, rngInt, rngPick } from "./rng";
import type { ActorId, EffectOp, IncomingEvent, IncomingEventType, WorldState } from "./types";
import { clamp100 } from "./math";

function makeEventId(turn: number, idx: number, type: IncomingEventType): string {
  return `T${turn}-E${idx}-${type}`;
}

function delta(
  key: Extract<EffectOp, { kind: "DELTA" }>["key"],
  amount: number,
  reason: string,
  visibility: EffectOp["visibility"],
): EffectOp {
  return { kind: "DELTA", key, amount, reason, visibility };
}

function deltaActor(
  actorId: ActorId,
  field: Extract<EffectOp, { kind: "DELTA_ACTOR" }>["field"],
  amount: number,
  reason: string,
  visibility: EffectOp["visibility"],
): EffectOp {
  return { kind: "DELTA_ACTOR", actorId, field, amount, reason, visibility };
}

export function generateIncomingEvents(
  world: WorldState,
  opts: { forcePressureEvent: boolean },
): IncomingEvent[] {
  const events: IncomingEvent[] = [];

  // Ensure at least one international and one domestic event.
  const hostile = Object.values(world.actors).filter((a) => a.postureTowardPlayer === "hostile");
  const pressureActorId: ActorId =
    hostile.length > 0 ? hostile[rngInt(world.rng, 0, hostile.length - 1)]!.id : rngPick(world.rng, ["US", "EU"]);

  if (opts.forcePressureEvent || rngChance(world.rng, 0.75)) {
    events.push(makePressureEvent(world, pressureActorId, events.length));
  }

  if (rngChance(world.rng, 0.7)) {
    events.push(makeDomesticUnrestEvent(world, events.length));
  } else {
    events.push(makeLeakEvent(world, events.length));
  }

  // Third event is optional but common.
  if (rngChance(world.rng, 0.65)) {
    events.push(makeSecurityEvent(world, pressureActorId, events.length));
  }

  return events;
}

function makePressureEvent(world: WorldState, actorId: ActorId, idx: number): IncomingEvent {
  const actorName = world.actors[actorId].name;
  const typeRoll = rngInt(world.rng, 1, 3);
  const type: IncomingEventType =
    typeRoll === 1 ? "SANCTIONS_WARNING" : typeRoll === 2 ? "IMF_CONTACT" : "ALLIANCE_SIGNAL";

  if (type === "SANCTIONS_WARNING") {
    const visibleDescription = `${actorName} officials signal a sanctions package is being drafted; they cite “regional destabilization” and opaque procurement networks.`;
    const effects: EffectOp[] = [
      deltaActor(actorId, "domesticPressure", +8, "Sanctions debate heats up", "hidden"),
      deltaActor(actorId, "trust", -6, "Perceived non-cooperation", "hidden"),
      delta("global.attentionLevel", +6, "Sanctions chatter raises attention", "public"),
    ];
    // Sanctions bite later if regime activates.
    const scheduled = [
      {
        id: `T${world.turn}-SC-SANCTIONS_BITE`,
        dueTurn: world.turn + rngInt(world.rng, 1, 2),
        kind: "SANCTIONS_BITE" as const,
        payload: { severity: clamp100(35 + world.actors[actorId].sanctionsPolicyStrength * 0.4) },
      },
    ];
    return {
      id: makeEventId(world.turn, idx, type),
      type,
      actor: actorId,
      urgency: 3,
      visibleDescription,
      playerChoicesHints: ["Offer inspections or transparency measures", "Threaten retaliation (credibility risk)", "Seek EU carve-outs"],
      hiddenPayload: { effects, scheduled },
    };
  }

  if (type === "IMF_CONTACT") {
    const visibleDescription =
      "IMF staff request a formal technical mission. The language is neutral, but financing conditions are implied in the background conversations.";
    const effects: EffectOp[] = [
      delta("player.economy.debtStress", -4, "Talks slightly calm market expectations", "hidden"),
      delta("player.economy.economicStability", +2, "IMF contact steadies short-term funding", "hidden"),
      delta("global.attentionLevel", +4, "IMF mission draws scrutiny", "public"),
    ];
    return {
      id: makeEventId(world.turn, idx, type),
      type,
      actor: "UNKNOWN",
      urgency: 2,
      visibleDescription,
      playerChoicesHints: ["Accept mission publicly", "Delay and seek bilateral financing", "Use mission to justify austerity"],
      hiddenPayload: { effects },
    };
  }

  // ALLIANCE_SIGNAL
  const visibleDescription =
    `${actorName} signals to partners that commitments depend on “predictable behavior” from your government. No public statement yet.`;
  const effects: EffectOp[] = [
    deltaActor(actorId, "allianceCommitmentStrength", -4, "Private doubts about reliability", "hidden"),
    delta("player.politics.credibilityGlobal", -2, "Alliance murmurs erode credibility", "hidden"),
  ];
  return {
    id: makeEventId(world.turn, idx, type),
    type,
    actor: actorId,
    urgency: 2,
    visibleDescription,
    playerChoicesHints: ["Send quiet reassurance", "Overreact publicly (credibility risk)", "Offer joint mechanism"],
    hiddenPayload: { effects },
  };
}

function makeDomesticUnrestEvent(world: WorldState, idx: number): IncomingEvent {
  const visibleDescription =
    "A protest call circulates for the weekend. Organizers cite food prices and corruption; security services warn the crowd could be larger than last quarter.";
  const effects: EffectOp[] = [
    delta("player.politics.unrest", +8, "Mobilization call increases unrest", "hidden"),
    delta("player.politics.legitimacy", -3, "Public anger at prices and graft", "hidden"),
  ];
  return {
    id: makeEventId(world.turn, idx, "PROTESTS"),
    type: "PROTESTS",
    actor: "DOMESTIC",
    urgency: 2,
    visibleDescription,
    playerChoicesHints: ["Preempt with targeted subsidies", "Crackdown (legitimacy risk)", "Anti-corruption announcement"],
    hiddenPayload: { effects },
  };
}

function makeLeakEvent(world: WorldState, idx: number): IncomingEvent {
  const visibleDescription =
    "An audio clip allegedly captures a senior official discussing patronage appointments. Authenticity is disputed; local media are amplifying it.";
  const effects: EffectOp[] = [
    delta("player.politics.corruption", +4, "Leak reinforces corruption perception", "hidden"),
    delta("player.politics.legitimacy", -4, "Leak damages legitimacy", "hidden"),
    delta("player.politics.publicApproval", -3, "Approval dips", "hidden"),
  ];
  return {
    id: makeEventId(world.turn, idx, "LEAKED_AUDIO"),
    type: "LEAKED_AUDIO",
    actor: "UNKNOWN",
    urgency: 1,
    visibleDescription,
    playerChoicesHints: ["Launch investigation", "Claim fabrication (credibility risk)", "Purge scapegoat"],
    hiddenPayload: { effects },
  };
}

function makeSecurityEvent(world: WorldState, pressureActorId: ActorId, idx: number): IncomingEvent {
  const type: IncomingEventType = rngPick(world.rng, ["BORDER_INCIDENT", "CYBER_INTRUSION", "ARMS_INTERDICTION"]);
  if (type === "BORDER_INCIDENT") {
    const visibleDescription =
      "Border troops report an exchange of fire after an unidentified group crossed a disputed sector. Casualties appear limited, but the incident is being filmed.";
    const effects: EffectOp[] = [
      delta("global.attentionLevel", +6, "Border incident raises attention", "public"),
      delta("player.politics.warSupport", +4, "Public rallies briefly", "hidden"),
      deltaActor(pressureActorId, "willingnessToEscalate", +4, "Security dynamic hardens", "hidden"),
    ];
    return {
      id: makeEventId(world.turn, idx, type),
      type,
      actor: "UNKNOWN",
      urgency: 3,
      visibleDescription,
      playerChoicesHints: ["Call for joint investigation", "Mobilize quietly", "Strike suspected camp (escalation risk)"],
      hiddenPayload: { effects },
    };
  }

  if (type === "CYBER_INTRUSION") {
    const visibleDescription =
      "A partial outage hits a ministry network. Forensics suggest an advanced actor, but attribution is not firm. Some documents may have been accessed.";
    const effects: EffectOp[] = [
      delta("player.politics.legitimacy", -2, "Perceived incompetence", "hidden"),
      delta("player.politics.credibilityGlobal", -1, "Leaks erode credibility", "hidden"),
    ];
    return {
      id: makeEventId(world.turn, idx, type),
      type,
      actor: "UNKNOWN",
      urgency: 2,
      visibleDescription,
      playerChoicesHints: ["Blame an actor (credibility risk)", "Quietly harden systems", "Counterintel operation"],
      hiddenPayload: { effects },
    };
  }

  // ARMS_INTERDICTION
  const visibleDescription =
    "A cargo shipment linked to your procurement network is stopped in transit. The carrier claims paperwork irregularities; foreign officials hint at sanctions evasion.";
  const effects: EffectOp[] = [
    delta("player.military.readiness", -3, "Delayed shipments reduce readiness", "hidden"),
    delta("global.attentionLevel", +5, "Interdiction draws scrutiny", "public"),
    delta("player.politics.credibilityGlobal", -2, "Evasion narrative spreads", "hidden"),
  ];
  return {
    id: makeEventId(world.turn, idx, type),
    type,
    actor: rngPick(world.rng, ["US", "EU", "CHINA"]),
    urgency: 2,
    visibleDescription,
    playerChoicesHints: ["Route procurement differently (corruption risk)", "Negotiate release", "Accelerate domestic production"],
    hiddenPayload: { effects },
  };
}

