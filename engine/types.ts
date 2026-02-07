import { z } from "zod";

export type Confidence = "low" | "med" | "high";

export type ObservedMetric = {
  estimatedValue: number;
  confidence: Confidence;
  knownDrivers: string[];
};

export type ActorId = "US" | "CHINA" | "RUSSIA" | "EU" | "REGIONAL_1" | "REGIONAL_2";

export type Posture = "hostile" | "neutral" | "friendly";

export type RegimeType = "hybrid" | "democracy" | "authoritarian";

export type DossierLevel = "critical" | "low" | "moderate" | "high";

export type DossierSignal = {
  level: DossierLevel;
  confidence: Confidence;
  note?: string;
};

export type ExternalActorState = {
  id: ActorId;
  name: string;
  objectives: { text: string; weight: number }[];
  redLines: string[];
  riskTolerance: number; // 0-100
  domesticPressure: number; // 0-100
  postureTowardPlayer: Posture;
  trust: number; // 0-100
  willingnessToEscalate: number; // 0-100
  sanctionsPolicyStrength: number; // 0-100
  allianceCommitmentStrength: number; // 0-100
};

export type GlobalSystems = {
  globalTradeTemperature: number; // 0-100
  globalEnergyMarketTightness: number; // 0-100
  attentionLevel: number; // 0-100
  sanctionsRegimeActive: boolean;
  allianceEdges: { a: ActorId; b: ActorId; strength: number }[];
};

export type ConflictFront = {
  region: string;
  control: "player" | "enemy" | "contested";
  intensity: number; // 0-100
};

export type ActiveConflict = {
  id: string;
  name: string;
  belligerents: { attacker: ActorId | "PLAYER"; defender: ActorId | "PLAYER" };
  escalationLevel: 1 | 2 | 3 | 4 | 5;
  fronts: ConflictFront[];
  attrition: number; // 0-100
  occupationBurden: number; // 0-100
  insurgencyRisk: number; // 0-100
  civilianHarm: number; // 0-100
  cumulativeCasualties: number; // index-ish
};

export type ScheduledConsequence = {
  id: string;
  dueTurn: number;
  kind:
    | "SANCTIONS_BITE"
    | "WAR_FATIGUE"
    | "INSURGENCY_SPIKE"
    | "INFLATION_LAG"
    | "ELITE_SPLIT_RISK"
    | "INTEL_REVELATION";
  payload: unknown;
};

export type PlayerCountryTrue = {
  name: string;
  geographySummary: string;
  neighbors: string[];
  regimeType: RegimeType;
  populationM: number;
  demographicsTags: string[];
  resources: {
    oilGas: number; // 0-100
    rareEarths: number; // 0-100
    food: number; // 0-100
    industrialBase: number; // 0-100
  };
  economy: {
    gdpIndex: number; // 0-200
    economicStability: number; // 0-100
    inflationPressure: number; // 0-100
    unemployment: number; // 0-100
    debtStress: number; // 0-100
  };
  military: {
    manpower: number; // 0-100
    readiness: number; // 0-100
    logistics: number; // 0-100
    techLevel: number; // 0-100
    airDefense: number; // 0-100
    cyber: number; // 0-100
  };
  tensions: {
    ethnic: number; // 0-100
    ideological: number; // 0-100
    regional: number; // 0-100
  };
  institutions: {
    courts: number; // 0-100
    parliament: number; // 0-100
    intelligenceServices: number; // 0-100
  };
  politics: {
    legitimacy: number; // 0-100
    eliteCohesion: number; // 0-100
    militaryLoyalty: number; // 0-100
    publicApproval: number; // 0-100
    mediaControl: number; // 0-100
    corruption: number; // 0-100
    warSupport: number; // 0-100
    unrest: number; // 0-100
    sovereigntyIntegrity: number; // 0-100
    credibilityGlobal: number; // 0-100
    credibilityByActor: Record<ActorId, number>; // 0-100
  };
  flags: {
    puppet: boolean;
    capitalOccupied: boolean;
  };
};

export type IncomingEventType =
  | "SANCTIONS_WARNING"
  | "BORDER_INCIDENT"
  | "PROTESTS"
  | "LEAKED_AUDIO"
  | "ARMS_INTERDICTION"
  | "IMF_CONTACT"
  | "CYBER_INTRUSION"
  | "ALLIANCE_SIGNAL"
  | "INSURGENT_ATTACK";

export type IncomingEvent = {
  id: string;
  type: IncomingEventType;
  actor: ActorId | "DOMESTIC" | "UNKNOWN";
  urgency: 1 | 2 | 3;
  visibleDescription: string;
  playerChoicesHints?: string[];
  hiddenPayload: {
    effects: EffectOp[];
    scheduled?: ScheduledConsequence[];
  };
};

export type PlayerIncomingEvent = Omit<IncomingEvent, "hiddenPayload">;

export type ControlRoomView = {
  // Numeric widgets shown in the control room. These are player-facing.
  pressure: {
    pressureIndex: number; // 0-100
    deltaPerTurn: number; // -25..25 (display only)
    narrativeGravity: number; // 0-100
    systemStrain: number; // 0-100
    note?: string;
  };
  hotspots: Array<{
    id: string;
    region: string;
    value: number; // 0-100
    trend: "up" | "down" | "stable";
    color: string; // e.g. #dc2626
    why?: string;
  }>;
  signals: Array<{
    id: string;
    label: string;
    intensity: number; // 0..1
    confidence: "LOW" | "MED" | "HIGH";
    why?: string;
  }>;
  briefings: Array<{
    id: string;
    timestamp: string;
    source: "Intercept" | "Foreign Desk" | "Markets" | "Embassy Cable";
    content: string;
  }>;
  map?: {
    // The map overlay can differ by mode; intensity maps to dot color per mode.
    clustersByMode: Partial<Record<"pressure" | "narrative" | "entanglement" | "sentiment", Array<{
      id: string;
      lat: number;
      lon: number;
      intensity: "high" | "med" | "low";
      radius: number;
      dotCount: number;
    }>>>;
    fogRegions?: Array<{ lat: number; lon: number; radius: number }>;
    homeRegion?: { lat: number; lon: number };
  };
  // Minimal memory marker so UI can show provenance.
  generatedBy: "llm";
  memory: {
    previousTurnsUsed: number;
    continuityNotes?: string[];
  };
};

export type Briefing = {
  text: string;
  headlines: string[];
  domesticRumors: string[];
  diplomaticMessages: string[];
  intelBriefs: { text: string; confidence: Confidence }[];
};

export type WorldState = {
  version: 1;
  rng: import("./rng").RngState;
  turn: number; // current turn number (1-based)
  player: PlayerCountryTrue;
  actors: Record<ActorId, ExternalActorState>;
  global: GlobalSystems;
  conflicts: ActiveConflict[];
  scheduled: ScheduledConsequence[];
  current: {
    briefing: Briefing;
    incomingEvents: IncomingEvent[];
  };
};

export type PlayerViewState = {
  indicators: {
    legitimacy: ObservedMetric;
    publicApproval: ObservedMetric;
    eliteCohesion: ObservedMetric;
    militaryLoyalty: ObservedMetric;
    economicStability: ObservedMetric;
    inflationPressure: ObservedMetric;
    unrestLevel: ObservedMetric;
    intelligenceClarity: ObservedMetric;
    internationalCredibility: ObservedMetric;
    sovereigntyIntegrity: ObservedMetric;
    warStatus: ObservedMetric;
  };
  briefing: Briefing;
  incomingEvents: PlayerIncomingEvent[];
  controlRoom?: ControlRoomView;
};

export type CountryProfile = {
  name: string;
  geographySummary: string;
  neighbors: string[];
  regimeType: RegimeType;
  resources: {
    oilGas: DossierLevel;
    food: DossierLevel;
    rareEarths: DossierLevel;
    industrialBase: DossierLevel;
  };
  startingAssessment: {
    economicStability: DossierSignal;
    legitimacy: DossierSignal;
    unrest: DossierSignal;
    intelClarity: DossierSignal;
  };
  vulnerabilities: string[];
  generatedBy: "llm" | "deterministic";
};

export type ForeignPower = {
  id: string;
  name: string;
  ministerName: string;
  description: string;
  stance: number; // 0-100
  hiddenAgenda: string;
  avatarId?: string;
  chatHistory?: Array<{ role: "user" | "minister"; text: string; timestamp: number }>;
};

export type GameSnapshot = {
  gameId: string;
  turn: number;
  status: "ACTIVE" | "FAILED";
  countryProfile: CountryProfile;
  diplomacy?: {
    nations: ForeignPower[];
  };
  playerView: PlayerViewState;
  actionLimit: number;
  actionTemplates: ActionTemplate[];
  llmMode?: "OFF" | "ON";
};

export type FailureType = "DOMESTIC_OUSTER" | "LOSS_OF_SOVEREIGNTY";

export type FailureDetails = {
  type: FailureType;
  title: string;
  primaryDrivers: string[];
  pointOfNoReturnGuess: string;
  lastTurns: { turn: number; headline: string; resolution: string }[];
};

export type TurnOutcome = {
  turnResolved: number;
  publicResolutionText: string;
  consequences: string[];
  signalsUnknown: string[];
  failure?: FailureDetails;
  nextSnapshot: GameSnapshot;
};

export type EffectOp =
  | {
      kind: "DELTA";
      key:
        | "player.politics.legitimacy"
        | "player.politics.eliteCohesion"
        | "player.politics.militaryLoyalty"
        | "player.politics.publicApproval"
        | "player.politics.mediaControl"
        | "player.politics.corruption"
        | "player.politics.warSupport"
        | "player.politics.unrest"
        | "player.politics.sovereigntyIntegrity"
        | "player.politics.credibilityGlobal"
        | "player.economy.economicStability"
        | "player.economy.inflationPressure"
        | "player.economy.unemployment"
        | "player.economy.debtStress"
        | "player.military.readiness"
        | "global.attentionLevel";
      amount: number;
      reason: string;
      visibility: "public" | "hidden";
    }
  | {
      kind: "DELTA_ACTOR";
      actorId: ActorId;
      field: keyof Pick<
        ExternalActorState,
        | "trust"
        | "willingnessToEscalate"
        | "domesticPressure"
        | "sanctionsPolicyStrength"
        | "allianceCommitmentStrength"
      >;
      amount: number;
      reason: string;
      visibility: "public" | "hidden";
    }
  | {
      kind: "SET_POSTURE";
      actorId: ActorId;
      posture: Posture;
      reason: string;
      visibility: "public" | "hidden";
    }
  | {
      kind: "SET_SANCTIONS";
      active: boolean;
      reason: string;
      visibility: "public" | "hidden";
    }
  | {
      kind: "START_CONFLICT";
      conflict: ActiveConflict;
      reason: string;
      visibility: "public" | "hidden";
    }
  | {
      kind: "SET_FLAG";
      flag: keyof PlayerCountryTrue["flags"];
      value: boolean;
      reason: string;
      visibility: "public" | "hidden";
    };

export type ActionTemplate = {
  id: string;
  category: PlayerAction["kind"];
  title: string;
  description: string;
  defaultAction: PlayerAction;
};

export const DiplomacyActionSchema = z.object({
  kind: z.literal("DIPLOMACY"),
  subkind: z.enum(["MESSAGE", "OFFER", "THREAT", "TREATY_PROPOSAL"]),
  targetActor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2"]),
  topic: z.enum(["security", "trade", "sanctions", "energy", "ceasefire", "intel"]),
  tone: z.enum(["conciliatory", "firm", "hostile"]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
});

export const EconomyActionSchema = z.object({
  kind: z.literal("ECONOMY"),
  subkind: z.enum(["SUBSIDIES", "AUSTERITY", "INDUSTRIAL_PUSH", "TRADE_DEAL_ATTEMPT"]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
  targetActor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2"]).optional(),
});

export const MilitaryActionSchema = z.object({
  kind: z.literal("MILITARY"),
  subkind: z.enum([
    "MOBILIZE",
    "LIMITED_STRIKE",
    "DEFENSIVE_POSTURE",
    "FULL_INVASION",
    "PROXY_SUPPORT",
    "ARMS_PURCHASE",
  ]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
  targetActor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2"]).optional(),
  targetRegion: z.string().optional(),
});

export const IntelActionSchema = z.object({
  kind: z.literal("INTEL"),
  subkind: z.enum(["SURVEILLANCE", "COUNTERINTEL", "COVERT_OP"]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
  targetActor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2"]).optional(),
});

export const MediaActionSchema = z.object({
  kind: z.literal("MEDIA"),
  subkind: z.enum(["PROPAGANDA_PUSH", "CENSORSHIP_CRACKDOWN", "NARRATIVE_FRAMING"]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
});

export const InstitutionsActionSchema = z.object({
  kind: z.literal("INSTITUTIONS"),
  subkind: z.enum(["PURGE_ELITES", "REFORM_PACKAGE", "ANTI_CORRUPTION_DRIVE", "ELECTION_TIMING"]),
  intensity: z.number().int().min(1).max(3),
  isPublic: z.boolean(),
});

export const PlayerActionSchema = z.discriminatedUnion("kind", [
  DiplomacyActionSchema,
  EconomyActionSchema,
  MilitaryActionSchema,
  IntelActionSchema,
  MediaActionSchema,
  InstitutionsActionSchema,
]);

export type PlayerAction = z.infer<typeof PlayerActionSchema>;

