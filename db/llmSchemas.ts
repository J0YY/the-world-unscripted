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
  visibility: z.enum(["public", "hidden"]),
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
  visibility: z.enum(["public", "hidden"]),
});

const EffectSetSanctionsSchema = z.object({
  kind: z.literal("SET_SANCTIONS"),
  active: z.boolean(),
  reason: z.string().min(4).max(140),
  visibility: z.enum(["public", "hidden"]),
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

