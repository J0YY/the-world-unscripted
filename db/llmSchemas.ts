import { z } from "zod";
import { PlayerActionSchema } from "@/engine";

const ScheduledKindSchema = z.enum([
  "SANCTIONS_BITE",
  "WAR_FATIGUE",
  "INSURGENCY_SPIKE",
  "INFLATION_LAG",
  "ELITE_SPLIT_RISK",
  "INTEL_REVELATION",
]);

const VisibilitySchema = z.preprocess((v) => {
  // Models sometimes emit "private"/"PUBLIC" or omit the field.
  // Normalize to our engine-facing visibility enum.
  if (v === undefined || v === null) return "hidden";
  if (typeof v !== "string") return v;
  const t = v.trim().toLowerCase();
  if (t === "private" || t === "internal" || t === "secret" || t === "nonpublic") return "hidden";
  if (t === "open") return "public";
  return t;
}, z.enum(["public", "hidden"]));

const EffectDeltaSchema = z.object({
  kind: z.literal("DELTA"),
  key: z.enum([
    "player.politics.legitimacy",
    "player.politics.eliteCohesion",
    "player.politics.militaryLoyalty",
    "player.politics.publicApproval",
    "player.politics.mediaControl",
    "player.politics.corruption",
    "player.politics.warSupport",
    "player.politics.unrest",
    "player.politics.sovereigntyIntegrity",
    "player.politics.credibilityGlobal",
    "player.economy.economicStability",
    "player.economy.inflationPressure",
    "player.economy.unemployment",
    "player.economy.debtStress",
    "player.military.readiness",
    "global.attentionLevel",
  ]),
  amount: z.number().int().min(-12).max(12),
  reason: z.string().min(4).max(140),
  visibility: VisibilitySchema,
});

const EffectDeltaActorSchema = z.object({
  kind: z.literal("DELTA_ACTOR"),
  actorId: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2"]),
  field: z.enum([
    "trust",
    "willingnessToEscalate",
    "domesticPressure",
    "sanctionsPolicyStrength",
    "allianceCommitmentStrength",
  ]),
  amount: z.number().int().min(-10).max(10),
  reason: z.string().min(4).max(140),
  visibility: VisibilitySchema,
});

const EffectSetSanctionsSchema = z.object({
  kind: z.literal("SET_SANCTIONS"),
  active: z.boolean(),
  reason: z.string().min(4).max(140),
  visibility: VisibilitySchema,
});

const EffectOpLiteSchema = z.discriminatedUnion("kind", [
  EffectDeltaSchema,
  EffectDeltaActorSchema,
  EffectSetSanctionsSchema,
]);

export const LlmGenerateTurnPackageSchema = z.object({
  briefing: z.object({
    text: z.string().min(60).max(8000),
    headlines: z.array(z.string().min(10).max(220)).min(3).max(7),
    domesticRumors: z.array(z.string().min(10).max(220)).min(1).max(5),
    diplomaticMessages: z.array(z.string().min(10).max(260)).min(1).max(5),
    intelBriefs: z
      .array(
        z.object({
          text: z.string().min(10).max(380),
          confidence: z.enum(["low", "med", "high"]),
        }),
      )
      .min(1)
      .max(4),
  }),
  // Full event list for the turn.
  events: z
    .array(
      z.object({
        type: z.enum([
          "SANCTIONS_WARNING",
          "BORDER_INCIDENT",
          "PROTESTS",
          "LEAKED_AUDIO",
          "ARMS_INTERDICTION",
          "IMF_CONTACT",
          "CYBER_INTRUSION",
          "ALLIANCE_SIGNAL",
          "INSURGENT_ATTACK",
        ]),
        actor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2", "DOMESTIC", "UNKNOWN"]),
        urgency: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        visibleDescription: z.string().min(20).max(700),
        playerChoicesHints: z.array(z.string().min(6).max(160)).min(0).max(6).optional(),
        effects: z.array(EffectOpLiteSchema).min(1).max(8),
        scheduled: z
          .array(
            z.object({
              kind: ScheduledKindSchema,
              dueInTurns: z.number().int().min(1).max(3),
              payload: z.unknown().optional(),
            }),
          )
          .max(4)
          .optional(),
      }),
    )
    .min(2)
    .max(5),
});

export const LlmRewriteTurnSchema = z.object({
  briefing: z.object({
    text: z.string().min(40).max(6000),
    headlines: z.array(z.string().min(10).max(220)).min(2).max(6),
    domesticRumors: z.array(z.string().min(10).max(220)).min(1).max(5),
    diplomaticMessages: z.array(z.string().min(10).max(260)).min(1).max(5),
    intelBriefs: z
      .array(
        z.object({
          text: z.string().min(10).max(380),
          confidence: z.enum(["low", "med", "high"]),
        }),
      )
      .min(1)
      .max(4),
  }),
  // Rewrite visible event text and hints; do not change ids/types/actors/urgency.
  events: z.array(
    z.object({
      id: z.string().min(1),
      visibleDescription: z.string().min(20).max(600),
      playerChoicesHints: z.array(z.string().min(6).max(140)).min(0).max(5).optional(),
    }),
  ),
  // Optional: inject one extra dynamic event with bounded effects.
  injectedEvent: z
    .object({
      type: z.enum([
        "SANCTIONS_WARNING",
        "BORDER_INCIDENT",
        "PROTESTS",
        "LEAKED_AUDIO",
        "ARMS_INTERDICTION",
        "IMF_CONTACT",
        "CYBER_INTRUSION",
        "ALLIANCE_SIGNAL",
        "INSURGENT_ATTACK",
      ]),
      actor: z.enum(["US", "CHINA", "RUSSIA", "EU", "REGIONAL_1", "REGIONAL_2", "DOMESTIC", "UNKNOWN"]),
      urgency: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      visibleDescription: z.string().min(20).max(600),
      playerChoicesHints: z.array(z.string().min(6).max(140)).min(0).max(5).optional(),
      effects: z.array(EffectOpLiteSchema).min(1).max(6),
    })
    .optional(),
});

export const LlmParseDirectiveSchema = z.object({
  actions: z.array(PlayerActionSchema).min(1).max(3),
  rationale: z.array(z.string().min(10).max(180)).min(1).max(6),
});

const DossierLevelSchema = z.enum(["critical", "low", "moderate", "high"]);

const DossierSignalSchema = z.object({
  level: DossierLevelSchema,
  confidence: z.enum(["low", "med", "high"]),
  note: z.string().min(6).max(120).optional(),
});

export const LlmCountryProfileSchema = z.object({
  name: z.string().min(2).max(80),
  geographySummary: z.string().min(80).max(700),
  neighbors: z.array(z.string().min(2).max(40)).min(2).max(6),
  regimeType: z.enum(["democracy", "hybrid", "authoritarian"]),
  resources: z.object({
    oilGas: DossierLevelSchema,
    food: DossierLevelSchema,
    rareEarths: DossierLevelSchema,
    industrialBase: DossierLevelSchema,
  }),
  startingAssessment: z.object({
    economicStability: DossierSignalSchema,
    legitimacy: DossierSignalSchema,
    unrest: DossierSignalSchema,
    intelClarity: DossierSignalSchema,
  }),
  vulnerabilities: z.array(z.string().min(12).max(160)).min(4).max(8),
  generatedBy: z.literal("llm"),
});

export const LlmSuggestDirectiveSchema = z.object({
  situation: z
    .object({
      headline: z.string().min(10).max(180),
      keyDevelopments: z.array(z.string().min(10).max(180)).min(2).max(6),
    })
    .describe("Brief, player-facing context."),
  suggestions: z.array(z.string().min(12).max(260)).min(3).max(7),
  redFlags: z.array(z.string().min(10).max(200)).min(0).max(6),
  questions: z.array(z.string().min(8).max(160)).min(0).max(5),
});

export const LlmResolutionSchema = z.object({
  headline: z.string().min(10).max(160),
  narrative: z.array(z.string().min(8).max(220)).min(4).max(18),
  directiveImpact: z
    .array(
      z.object({
        directiveFragment: z.string().min(4).max(120),
        translatedOps: z.array(z.string().min(6).max(140)).min(0).max(4),
        observedEffects: z.array(z.string().min(8).max(160)).min(1).max(5),
      }),
    )
    .min(2)
    .max(8),
  perceptions: z
    .array(
      z.object({
        actor: z.string().min(2).max(40),
        posture: z.enum(["hostile", "neutral", "friendly"]),
        read: z.string().min(10).max(160),
      }),
    )
    .min(2)
    .max(8),
  threats: z.array(z.string().min(10).max(180)).min(2).max(7),
  nextMoves: z.array(z.string().min(10).max(200)).min(2).max(6),
});

export const LlmWorldGenScenarioSchema = z.object({
  location: z.object({
    lat: z.number().min(-85).max(85),
    lon: z.number().min(-180).max(180),
    regionLabel: z.string().min(3).max(80),
  }),
  player: z.object({
    name: z.string().min(2).max(50),
    geographySummary: z.string().min(80).max(900),
    neighbors: z.array(z.string().min(2).max(40)).min(2).max(6),
    regimeType: z.enum(["democracy", "hybrid", "authoritarian"]),
  }),
  regionalPowers: z.tuple([z.string().min(2).max(40), z.string().min(2).max(40)]),
  notes: z.array(z.string().min(6).max(160)).max(6).optional(),
});

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LlmControlRoomViewSchema = z.object({
  pressure: z.object({
    pressureIndex: z.number().int().min(0).max(100),
    deltaPerTurn: z.number().int().min(-25).max(25),
    narrativeGravity: z.number().int().min(0).max(100),
    systemStrain: z.number().int().min(0).max(100),
    note: z.string().min(6).max(140).optional(),
  }),
  hotspots: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        region: z.string().min(3).max(80),
        value: z.number().int().min(0).max(100),
        trend: z.enum(["up", "down", "stable"]),
        color: HexColorSchema,
        why: z.string().min(6).max(140).optional(),
      }),
    )
    .min(3)
    .max(8),
  signals: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(3).max(40),
        intensity: z.number().min(0).max(1),
        confidence: z.enum(["LOW", "MED", "HIGH"]),
        why: z.string().min(6).max(140).optional(),
      }),
    )
    .min(4)
    .max(10),
  briefings: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        timestamp: z.string().min(1).max(16),
        source: z.enum(["Intercept", "Foreign Desk", "Markets", "Embassy Cable"]),
        content: z.string().min(10).max(380),
      }),
    )
    .min(4)
    .max(14),
  map: z
    .object({
      clustersByMode: z
        .object({
          pressure: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                lat: z.number().min(-85).max(85),
                lon: z.number().min(-180).max(180),
                intensity: z.enum(["high", "med", "low"]),
                radius: z.number().int().min(10).max(120),
                dotCount: z.number().int().min(6).max(40),
              }),
            )
            .min(1)
            .max(8)
            .optional(),
          narrative: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                lat: z.number().min(-85).max(85),
                lon: z.number().min(-180).max(180),
                intensity: z.enum(["high", "med", "low"]),
                radius: z.number().int().min(10).max(120),
                dotCount: z.number().int().min(6).max(40),
              }),
            )
            .min(1)
            .max(8)
            .optional(),
          entanglement: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                lat: z.number().min(-85).max(85),
                lon: z.number().min(-180).max(180),
                intensity: z.enum(["high", "med", "low"]),
                radius: z.number().int().min(10).max(120),
                dotCount: z.number().int().min(6).max(40),
              }),
            )
            .min(1)
            .max(8)
            .optional(),
          sentiment: z
            .array(
              z.object({
                id: z.string().min(1).max(80),
                lat: z.number().min(-85).max(85),
                lon: z.number().min(-180).max(180),
                intensity: z.enum(["high", "med", "low"]),
                radius: z.number().int().min(10).max(120),
                dotCount: z.number().int().min(6).max(40),
              }),
            )
            .min(1)
            .max(8)
            .optional(),
        })
        .strict(),
      fogRegions: z
        .array(z.object({ lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180), radius: z.number().min(5).max(50) }))
        .min(0)
        .max(6)
        .optional(),
      homeRegion: z.object({ lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180) }).optional(),
    })
    .optional(),
  generatedBy: z.literal("llm"),
  memory: z.object({
    previousTurnsUsed: z.number().int().min(0).max(5),
    continuityNotes: z.array(z.string().min(6).max(160)).max(6).optional(),
  }),
});
