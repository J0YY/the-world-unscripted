import type {
  ActionTemplate,
  ActorId,
  CountryProfile,
  DossierLevel,
  DossierSignal,
  GameSnapshot,
  ObservedMetric,
  PlayerIncomingEvent,
  WorldState,
} from "./types";
import { observeMetric } from "./intel";
import { clamp100 } from "./math";

const ACTION_LIMIT = 2;

function dossierLevel(v: number): DossierLevel {
  if (v >= 75) return "high";
  if (v >= 55) return "moderate";
  if (v >= 35) return "low";
  return "critical";
}

function dossierSignal(m: ObservedMetric, opts?: { invert?: boolean; note?: string }): DossierSignal {
  const inv = opts?.invert ? 100 - m.estimatedValue : m.estimatedValue;
  return { level: dossierLevel(inv), confidence: m.confidence, note: opts?.note };
}

export function buildCountryProfile(
  world: WorldState,
  indicators: Pick<
    GameSnapshot["playerView"]["indicators"],
    "economicStability" | "legitimacy" | "unrestLevel" | "intelligenceClarity"
  >,
): CountryProfile {
  const p = world.player;
  const vulnerabilities: string[] = [];
  if (p.economy.debtStress >= 60) vulnerabilities.push("Debt refinancing risk; external financing leverage is real.");
  if (p.economy.inflationPressure >= 60) vulnerabilities.push("Food/fuel price sensitivity; unrest can spike quickly.");
  if (p.economy.unemployment >= 60) vulnerabilities.push("Employment shock risk; street pressure can rise without warning.");
  if (p.tensions.ethnic >= 60 || p.tensions.regional >= 60)
    vulnerabilities.push("Internal fault lines could be exploited by adversaries or opportunists.");
  if (p.politics.eliteCohesion <= 45) vulnerabilities.push("Elite fragmentation risk; coups and policy sabotage become plausible.");
  if (p.politics.militaryLoyalty <= 45) vulnerabilities.push("Military loyalty is uncertain; coercive capacity may fracture under stress.");
  if (p.institutions.intelligenceServices <= 45) vulnerabilities.push("Intelligence clarity is limited; deception risk is high.");
  if (p.military.logistics <= 45) vulnerabilities.push("Logistics constraints limit sustained operations.");
  if (p.politics.corruption >= 65) vulnerabilities.push("Corruption exposure; reforms can trigger backlash, inaction bleeds legitimacy.");
  if (p.politics.mediaControl >= 70) vulnerabilities.push("Information ecosystem is brittle; narrative control can collapse fast under shocks.");
  if (vulnerabilities.length < 4) vulnerabilities.push("Credibility is recoverable but fragile; bluffing will be punished.");

  return {
    name: p.name,
    geographySummary: p.geographySummary,
    neighbors: p.neighbors,
    regimeType: p.regimeType,
    resources: {
      oilGas: dossierLevel(p.resources.oilGas),
      food: dossierLevel(p.resources.food),
      rareEarths: dossierLevel(p.resources.rareEarths),
      industrialBase: dossierLevel(p.resources.industrialBase),
    },
    startingAssessment: {
      economicStability: dossierSignal(indicators.economicStability),
      legitimacy: dossierSignal(indicators.legitimacy),
      unrest: dossierSignal(indicators.unrestLevel, { invert: true }),
      intelClarity: dossierSignal(indicators.intelligenceClarity),
    },
    vulnerabilities: vulnerabilities.slice(0, 6),
    generatedBy: "deterministic",
  };
}

function sanitizeEvents(world: WorldState): PlayerIncomingEvent[] {
  return world.current.incomingEvents.map((e) => {
    const { hiddenPayload, ...visible } = e;
    void hiddenPayload;
    return visible;
  });
}

function warStatusTrue(world: WorldState): number {
  if (world.conflicts.length === 0) return 0;
  const avgEsc = world.conflicts.reduce((a, c) => a + c.escalationLevel, 0) / world.conflicts.length;
  const avgAttr = world.conflicts.reduce((a, c) => a + c.attrition, 0) / world.conflicts.length;
  return clamp100(avgEsc * 15 + avgAttr * 0.6);
}

export function defaultActionTemplates(world: WorldState): ActionTemplate[] {
  const actorList: ActorId[] = ["US", "EU", "CHINA", "RUSSIA", "REGIONAL_1", "REGIONAL_2"];
  const pressureTarget = actorList.sort((a, b) => world.actors[b].domesticPressure - world.actors[a].domesticPressure)[0]!;

  return [
    {
      id: "diplo-quiet-reassurance",
      category: "DIPLOMACY",
      title: "Quiet reassurance to a pressured capital",
      description: "Private message offering predictable process; avoids public cornering.",
      defaultAction: {
        kind: "DIPLOMACY",
        subkind: "MESSAGE",
        targetActor: pressureTarget,
        topic: "sanctions",
        tone: "conciliatory",
        intensity: 2,
        isPublic: false,
      },
    },
    {
      id: "econ-targeted-subsidies",
      category: "ECONOMY",
      title: "Targeted food & fuel subsidies",
      description: "Short-term relief; risks debt and inflation later if overused.",
      defaultAction: { kind: "ECONOMY", subkind: "SUBSIDIES", intensity: 2, isPublic: true },
    },
    {
      id: "mil-mobilize-limited",
      category: "MILITARY",
      title: "Limited mobilization posture",
      description: "Raises readiness and deterrence; costs the economy and raises attention.",
      defaultAction: { kind: "MILITARY", subkind: "MOBILIZE", intensity: 2, isPublic: true },
    },
    {
      id: "intel-counterintel",
      category: "INTEL",
      title: "Counterintelligence sweep",
      description: "Reduces deception risk, but can unsettle elites if politicized.",
      defaultAction: { kind: "INTEL", subkind: "COUNTERINTEL", intensity: 2, isPublic: false },
    },
    {
      id: "media-narrative-frame",
      category: "MEDIA",
      title: "Narrative framing (disciplined, low-key)",
      description: "Pushes a coherent line; may backfire if reality diverges.",
      defaultAction: { kind: "MEDIA", subkind: "NARRATIVE_FRAMING", intensity: 2, isPublic: true },
    },
    {
      id: "inst-anti-corruption",
      category: "INSTITUTIONS",
      title: "Anti-corruption drive (selective)",
      description: "Improves legitimacy if credible; can fracture elite cohesion.",
      defaultAction: { kind: "INSTITUTIONS", subkind: "ANTI_CORRUPTION_DRIVE", intensity: 2, isPublic: true },
    },
  ];
}

export function buildSnapshot(gameId: string, world: WorldState, status: "ACTIVE" | "FAILED"): GameSnapshot {
  const p = world.player;
  const drivers = {
    legitimacy: ["Polling proxies", "Elite chatter", "Protest logistics signals"],
    approval: ["Consumer price index proxy", "Local media tone", "Opposition fundraising activity"],
    elite: ["Cabinet leak patterns", "Patronage flows", "Security service alignment"],
    mil: ["Command rotations", "Budget execution", "Field reports from border units"],
    econ: ["FX pressure proxy", "Import invoices", "Bank liquidity rumors"],
    inflation: ["Staple basket prices", "Fuel distribution constraints", "Wholesale inventory levels"],
    unrest: ["Permit requests", "Messaging app volume", "Provincial police absenteeism"],
    intel: ["Source reliability", "Attribution confidence", "Counterintel anomalies"],
    cred: ["Foreign statements", "Backchannel response time", "Consistency of commitments"],
    sov: ["Border incidents", "Alliance signaling", "Force posture shifts"],
    war: ["Frontline reports", "Casualty reporting gaps", "Civilian harm narratives"],
  };

  const warTrue = warStatusTrue(world);
  const intelClarityTrue = clamp100(p.institutions.intelligenceServices - (world.conflicts.length > 0 ? 10 : 0));

  const indicators = {
    legitimacy: observeMetric(world, p.politics.legitimacy, { scale: 100, drivers: drivers.legitimacy }),
    publicApproval: observeMetric(world, p.politics.publicApproval, { scale: 100, drivers: drivers.approval }),
    eliteCohesion: observeMetric(world, p.politics.eliteCohesion, { scale: 100, drivers: drivers.elite }),
    militaryLoyalty: observeMetric(world, p.politics.militaryLoyalty, { scale: 100, drivers: drivers.mil }),
    economicStability: observeMetric(world, p.economy.economicStability, { scale: 100, drivers: drivers.econ }),
    inflationPressure: observeMetric(world, p.economy.inflationPressure, { scale: 100, drivers: drivers.inflation }),
    unrestLevel: observeMetric(world, p.politics.unrest, { scale: 100, drivers: drivers.unrest }),
    intelligenceClarity: observeMetric(world, intelClarityTrue, {
      scale: 100,
      drivers: drivers.intel,
      extraUncertainty: world.conflicts.length > 0 ? 0.25 : 0,
    }),
    internationalCredibility: observeMetric(world, p.politics.credibilityGlobal, { scale: 100, drivers: drivers.cred }),
    sovereigntyIntegrity: observeMetric(world, p.politics.sovereigntyIntegrity, { scale: 100, drivers: drivers.sov }),
    warStatus: observeMetric(world, warTrue, {
      scale: 100,
      drivers: drivers.war,
      extraUncertainty: world.conflicts.length > 0 ? 0.35 : 0.1,
    }),
  };

  // Build baseline diplomacy from engine state so the relationship map
  // always has data even before LLM hydration replaces it with richer profiles.
  const baselineDiplomacy = {
    nations: (Object.keys(world.actors) as ActorId[]).map((k) => {
      const a = world.actors[k];
      return {
        id: a.id,
        name: a.name,
        ministerName: "",
        description: "",
        stance: a.trust,
        hiddenAgenda: "",
        chatHistory: [] as Array<{ role: "user" | "minister"; text: string; timestamp: number }>,
      };
    }),
  };

  return {
    gameId,
    turn: world.turn,
    status,
    countryProfile: buildCountryProfile(world, indicators),
    diplomacy: baselineDiplomacy,
    actionLimit: ACTION_LIMIT,
    actionTemplates: defaultActionTemplates(world),
    playerView: {
      briefing: world.current.briefing,
      incomingEvents: sanitizeEvents(world),
      indicators: {
        ...indicators,
      },
    },
  };
}

