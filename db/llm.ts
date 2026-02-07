import type { CountryProfile, GameSnapshot, IncomingEvent, PlayerAction, WorldState } from "@/engine";
import { PlayerActionSchema } from "@/engine";
import type { z } from "zod";
import {
  LlmControlRoomViewSchema,
  LlmCountryProfileSchema,
  LlmGenerateTurnPackageSchema,
  LlmParseDirectiveSchema,
  LlmResolutionSchema,
  LlmRewriteTurnSchema,
  LlmSuggestDirectiveSchema,
  LlmWorldGenScenarioSchema,
} from "./llmSchemas";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export type LlmMode = "OFF" | "ON";

export function llmMode(): LlmMode {
  return (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) ? "ON" : "OFF";
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

async function chatJson<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  validate: (obj: unknown) => T;
  temperature?: number;
}): Promise<{ data: T; raw: unknown }> {
  if (process.env.GEMINI_API_KEY) {
    return chatJsonGemini(args);
  }
  if (process.env.OPENAI_API_KEY) {
    return chatJsonOpenAI(args);
  }
  throw new Error("No LLM API keys configured (OPENAI_API_KEY or GEMINI_API_KEY)");
}

async function chatJsonGemini<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  validate: (obj: unknown) => T;
  temperature?: number;
}): Promise<{ data: T; raw: unknown }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: args.temperature ?? 0.7,
      },
    }),
  });

  const payload: GeminiGenerateContentResponse = await res.json().catch(() => ({} as GeminiGenerateContentResponse));
  if (!res.ok) {
    const msg = payload.error?.message || `Gemini error (${res.status})`;
    throw new Error(msg);
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Gemini returned no text content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`LLM (Gemini) returned non-JSON for ${args.schemaName}`);
  }
  return { data: args.validate(parsed), raw: parsed };
}

async function chatJsonOpenAI<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  validate: (obj: unknown) => T;
  temperature?: number;
}): Promise<{ data: T; raw: unknown }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured on server");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      temperature: args.temperature ?? 0.7,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof payload === "object" && payload !== null && "error" in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `OpenAI error (${res.status})`;
    throw new Error(msg);
  }

  const content = extractChatContent(payload);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM returned non-JSON for ${args.schemaName}`);
  }
  return { data: args.validate(parsed), raw: parsed };
}

function extractChatContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const p = payload as { choices?: unknown };
  if (!Array.isArray(p.choices) || p.choices.length === 0) return "";
  const first = p.choices[0] as { message?: unknown; delta?: unknown };
  const message = first.message as { content?: unknown } | undefined;
  const delta = first.delta as { content?: unknown } | undefined;
  const content = message?.content ?? delta?.content;
  return typeof content === "string" ? content : "";
}

export async function llmRewriteTurn(args: {
  world: WorldState;
  events: IncomingEvent[];
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
}): Promise<{
  rewrittenBriefing: WorldState["current"]["briefing"];
  rewrittenEvents: Pick<IncomingEvent, "id" | "playerChoicesHints" | "visibleDescription">[];
  injectedEvent?: IncomingEvent;
  llmRaw: unknown;
}> {
  const system = [
    "You are writing grounded geopolitical simulation briefings and event descriptions.",
    "Tone rules: unsentimental, Reuters/cabinet memo style, no poetry, no melodrama.",
    "Output MUST be strict JSON object.",
    "Do NOT reveal hidden game mechanics; do not mention 'WorldState' or 'RNG'.",
    "Do NOT include any numeric ratings/scores (no '72/100', no raw indices). Use qualitative buckets only: critical/low/moderate/high.",
    "You may rewrite text for clarity and plausibility; keep it short and operational.",
    "If you inject an extra event, effects must be modest, realistic, and bounded.",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const user = [
    `PHASE: ${args.phase}`,
    args.playerDirective ? `PLAYER_DIRECTIVE: ${args.playerDirective}` : "PLAYER_DIRECTIVE: (none)",
    args.lastTurnPublicResolution ? `LAST_TURN_PUBLIC_RESOLUTION:\n${args.lastTurnPublicResolution}` : "",
    "",
    "CONTEXT (qualitative only; do not invent numeric scores):",
    JSON.stringify(context, null, 2),
    "",
    "CURRENT_PLAYER_BRIEFING (you may rewrite):",
    JSON.stringify(args.world.current.briefing, null, 2),
    "",
    "INCOMING_EVENTS (keep ids/types/actors/urgency, rewrite visibleDescription/hints):",
    JSON.stringify(
      args.events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        urgency: e.urgency,
        visibleDescription: e.visibleDescription,
        playerChoicesHints: e.playerChoicesHints ?? [],
      })),
      null,
      2,
    ),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        briefing: {
          text: "string",
          headlines: ["string"],
          domesticRumors: ["string"],
          diplomaticMessages: ["string"],
          intelBriefs: [{ text: "string", confidence: "low|med|high" }],
        },
        events: [{ id: "string", visibleDescription: "string", playerChoicesHints: ["string"] }],
        injectedEvent: {
          type: "optional",
          actor: "optional",
          urgency: 2,
          visibleDescription: "string",
          playerChoicesHints: ["string"],
          effects: [{ kind: "DELTA", key: "player.politics.legitimacy", amount: -2, reason: "string", visibility: "hidden" }],
        },
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmRewriteTurnSchema",
    validate: (obj) => LlmRewriteTurnSchema.parse(obj),
    temperature: 0.8,
  });

  // Safety: fail closed if model leaks obvious numeric truth patterns into player-visible text.
  if (leaksNumbers(data.briefing.text)) throw new Error("LLM briefing leaked numeric scoring; disabled for this turn");

  const rewrittenBriefing = data.briefing;
  const rewrittenEvents = data.events.map((e) => ({
    id: e.id,
    visibleDescription: e.visibleDescription,
    playerChoicesHints: e.playerChoicesHints,
  }));

  let injectedEvent: IncomingEvent | undefined;
  if (data.injectedEvent) {
    injectedEvent = {
      id: `T${args.world.turn}-E_LLM-INJECTED`,
      type: data.injectedEvent.type as IncomingEvent["type"],
      actor: data.injectedEvent.actor as IncomingEvent["actor"],
      urgency: data.injectedEvent.urgency,
      visibleDescription: data.injectedEvent.visibleDescription,
      playerChoicesHints: data.injectedEvent.playerChoicesHints,
      hiddenPayload: { effects: data.injectedEvent.effects as IncomingEvent["hiddenPayload"]["effects"], scheduled: [] },
    };
  }

  return { rewrittenBriefing, rewrittenEvents, injectedEvent, llmRaw: raw };
}

export async function llmGenerateTurnPackage(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
}): Promise<{ briefing: WorldState["current"]["briefing"]; events: IncomingEvent[]; llmRaw: unknown }> {
  const system = [
    "You are the turn generator for a grounded geopolitical simulation.",
    "Tone: unsentimental, Reuters/cabinet memo style, operational language.",
    "Output MUST be strict JSON object only.",
    "You must generate: briefing + 2-5 incoming events.",
    "Hard constraints:",
    "- Include at least 1 international development, 1 domestic development, and 1 intelligence note with uncertainty.",
    "- Do NOT include any numeric ratings/scores (no '72/100', no indices). Use qualitative buckets only: critical/low/moderate/high.",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Events must be plausible: sanctions, protests, leaks, border incidents, interdictions, IMF contact, cyber incidents, insurgent attacks.",
    "- Event effects must be modest and bounded; use the provided keys only.",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const user = [
    `PHASE: ${args.phase}`,
    args.playerDirective ? `PLAYER_DIRECTIVE: ${args.playerDirective}` : "PLAYER_DIRECTIVE: (none)",
    args.lastTurnPublicResolution ? `LAST_TURN_PUBLIC_RESOLUTION:\n${args.lastTurnPublicResolution}` : "",
    "",
    "CONTEXT (qualitative only; do not invent numeric scores):",
    JSON.stringify(context, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        briefing: {
          text: "string",
          headlines: ["string"],
          domesticRumors: ["string"],
          diplomaticMessages: ["string"],
          intelBriefs: [{ text: "string", confidence: "low|med|high" }],
        },
        events: [
          {
            type: "SANCTIONS_WARNING",
            actor: "US|EU|CHINA|RUSSIA|REGIONAL_1|REGIONAL_2|DOMESTIC|UNKNOWN",
            urgency: 1,
            visibleDescription: "string",
            playerChoicesHints: ["string"],
            effects: [{ kind: "DELTA", key: "player.politics.legitimacy", amount: -2, reason: "string", visibility: "hidden" }],
            scheduled: [{ kind: "SANCTIONS_BITE", dueInTurns: 2, payload: {} }],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmGenerateTurnPackageSchema",
    validate: (obj) => LlmGenerateTurnPackageSchema.parse(obj),
    temperature: 0.85,
  });

  // Safety: fail closed if model leaks obvious numeric truth patterns into player-visible text.
  if (leaksNumbers(data.briefing.text)) throw new Error("LLM briefing leaked numeric scoring; disabled for this turn");

  const turn = args.world.turn;
  const events: IncomingEvent[] = data.events.map((e, idx) => ({
    id: `T${turn}-E${idx}-LLM-${e.type}`,
    type: e.type as IncomingEvent["type"],
    actor: e.actor as IncomingEvent["actor"],
    urgency: e.urgency,
    visibleDescription: e.visibleDescription,
    playerChoicesHints: e.playerChoicesHints,
    hiddenPayload: {
      effects: e.effects as IncomingEvent["hiddenPayload"]["effects"],
      scheduled: (e.scheduled ?? []).map((s, j) => ({
        id: `T${turn}-SC${idx}-${j}-${s.kind}`,
        dueTurn: turn + s.dueInTurns,
        kind: s.kind,
        payload: s.payload ?? {},
      })),
    },
  }));

  return { briefing: data.briefing, events, llmRaw: raw };
}

export async function llmParsePlayerDirective(args: {
  directive: string;
  world: WorldState;
  remainingSlots: number;
}): Promise<{ actions: PlayerAction[]; rationale: string[]; llmRaw: unknown }> {
  const context = summarizeWorldForLlm(args.world);

  const allowed = [
    "Allowed actions:",
    "- DIPLOMACY subkind: MESSAGE | OFFER | THREAT | TREATY_PROPOSAL (requires targetActor, topic, tone)",
    "- ECONOMY subkind: SUBSIDIES | AUSTERITY | INDUSTRIAL_PUSH | TRADE_DEAL_ATTEMPT",
    "- MILITARY subkind: MOBILIZE | LIMITED_STRIKE | DEFENSIVE_POSTURE | FULL_INVASION | PROXY_SUPPORT | ARMS_PURCHASE",
    "- INTEL subkind: SURVEILLANCE | COUNTERINTEL | COVERT_OP",
    "- MEDIA subkind: PROPAGANDA_PUSH | CENSORSHIP_CRACKDOWN | NARRATIVE_FRAMING",
    "- INSTITUTIONS subkind: PURGE_ELITES | REFORM_PACKAGE | ANTI_CORRUPTION_DRIVE | ELECTION_TIMING",
    "Rules:",
    "- Output strict JSON only.",
    "- Always return 1..remainingSlots actions.",
    "- Use intensity 1-3. Choose isPublic (true/false).",
    "- If the directive asks for something too extreme/illegal/impossible, map it to the closest allowed action(s) instead of failing.",
    "- IMPORTANT TARGETING: If the directive names a country/region that is NOT one of the actor ids, put that place name into targetRegion (free text).",
    "- Do NOT set targetActor to US/CHINA/RUSSIA/EU unless the directive explicitly mentions that actor; prefer REGIONAL_1/REGIONAL_2 for local conflicts.",
  ].join("\n");

  const system = [
    "You translate player intent into structured actions for a grounded geopolitical simulation.",
    "You MUST output strict JSON.",
    allowed,
  ].join("\n");

  const user = [
    `REMAINING_SLOTS: ${args.remainingSlots}`,
    "PLAYER_DIRECTIVE:",
    args.directive,
    "",
    "CONTEXT (qualitative only):",
    JSON.stringify(context, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        actions: [
          {
            kind: "DIPLOMACY|ECONOMY|MILITARY|INTEL|MEDIA|INSTITUTIONS",
            subkind: "string",
            intensity: 2,
            isPublic: false,
          },
        ],
        rationale: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");

  let data: z.infer<typeof LlmParseDirectiveSchema>;
  let raw: unknown;
  try {
    ({ data, raw } = await chatJson({
      system,
      user,
      schemaName: "LlmParseDirectiveSchema",
      validate: (obj) => LlmParseDirectiveSchema.parse(obj),
      temperature: 0.25,
    }));
  } catch (e) {
    // Retry with a simpler instruction set (models sometimes choke on schema descriptions).
    const retrySystem = [
      "You are converting a player directive into VALID actions.",
      "Return strict JSON only.",
      "Do not add extra keys.",
      "If you are unsure, choose conservative actions that still make progress.",
      allowed,
    ].join("\n");
    const retryUser = [
      `REMAINING_SLOTS: ${args.remainingSlots}`,
      "PLAYER_DIRECTIVE:",
      args.directive,
      "",
      "CONTEXT:",
      JSON.stringify(context, null, 2),
      "",
      "IMPORTANT: Your previous attempt failed validation with this error:",
      (e as Error).message,
      "",
      "Return JSON with exactly these keys: actions, rationale",
    ].join("\n");

    ({ data, raw } = await chatJson({
      system: retrySystem,
      user: retryUser,
      schemaName: "LlmParseDirectiveSchema_retry",
      validate: (obj) => LlmParseDirectiveSchema.parse(obj),
      temperature: 0.1,
    }));
  }

  const actions = data.actions.slice(0, Math.max(0, args.remainingSlots));
  // Validate again (defensive)
  const validated = PlayerActionSchema.array().parse(actions);
  return { actions: validated, rationale: data.rationale, llmRaw: raw };
}

export async function llmAgentChat(args: {
  world: WorldState;
  userMessage: string;
}): Promise<string> {
  const system = [
    "You are an elite Senior Analyst at the National Intelligence Agency (NIA).",
    "Your role is to advise the Head of State (the user) on the current geopolitical crisis.",
    "IDENTITY & TONE:",
    "- Professional, concise, objective, but vigilant. Slightly cynical/realist in your geopolitical outlook.",
    "- You are helpful but not servile. You are an expert offering counsel.",
    "- Address the user as 'Director', 'Mr./Madam President', or simply 'Sir/Ma'am'.",
    "- Occasional uncertainty is realistic. If data is unclear, say so. 'Intelligence is patchy on this, but...'",
    "",
    "KNOWLEDGE & CONSTRAINTS:",
    "- You have access to the dashboard state (World Pressure, Hotspots). Interpret these.",
    "- World Pressure > 50% is dangerous. > 80% is critical failure territory.",
    "- NEVER reveal raw underlying numbers (0-100 values) specifically. Use qualitative terms: 'Stable', 'Elevated', 'Volatile', 'Critical'.",
    "- If asked about game mechanics, answer in-universe. (e.g., 'Action points' are 'political capital' or 'agency resources').",
    "- If asked about the future: Offer logical speculation based on current trends. Do NOT prophesy. Use phrases like 'Projected models suggest...' or 'There is a high probability of...'",
    "- Be proactive: If a specific hotspot is Critical(>60), warn the user about it even if not asked directly.",
    "",
    "FORMAT:",
    "- Keep responses short (1-3 sentences) for standard queries. The user is busy.",
    "- Only provide long replies if explicitly asked for a 'full report' or 'deep dive'.",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const user = [
    "CONTEXT (qualitative only):",
    JSON.stringify(context, null, 2),
    "",
    "PLAYER_MESSAGE:",
    args.userMessage,
  ].join("\n");

  return llmChat({
    system,
    user,
    temperature: 0.7,
  });
}

function dossierLevel(v: number): "critical" | "low" | "moderate" | "high" {
  if (v >= 75) return "high";
  if (v >= 55) return "moderate";
  if (v >= 35) return "low";
  return "critical";
}

function dossierSignalFromEstimated(
  estimatedValue: number,
  confidence: "low" | "med" | "high",
  opts?: { invert?: boolean },
) {
  const inv = opts?.invert ? 100 - estimatedValue : estimatedValue;
  return { level: dossierLevel(inv), confidence };
}

export async function llmGenerateCountryProfile(args: {
  world: WorldState;
  indicators: {
    economicStability: { estimatedValue: number; confidence: "low" | "med" | "high" };
    legitimacy: { estimatedValue: number; confidence: "low" | "med" | "high" };
    unrestLevel: { estimatedValue: number; confidence: "low" | "med" | "high" };
    intelligenceClarity: { estimatedValue: number; confidence: "low" | "med" | "high" };
  };
}): Promise<{ countryProfile: CountryProfile; llmRaw: unknown }> {
  const p = args.world.player;

  const canon = {
    name: p.name,
    neighbors: p.neighbors,
    regimeType: p.regimeType,
  };

  const system = [
    "You are producing a concise but thorough initial country dossier for a geopolitical simulation game.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "You MUST match the provided canonical fields exactly: name, neighbors (same order), regimeType.",
    "Do NOT output raw numbers (no scores, no 0-100 values). Use only qualitative levels: critical, low, moderate, high.",
    "Write geographySummary as 2–4 sentences, grounded and specific (no fantasy).",
    "Vulnerabilities must be concrete, actionable, and phrased as intelligence-style risk statements.",
    "Fill startingAssessment consistently with the provided qualitative signal context (you may add a short note per signal).",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const user = [
    "CANONICAL (must match exactly):",
    JSON.stringify(canon, null, 2),
    "",
    "QUALITATIVE CONTEXT:",
    JSON.stringify(
      {
        ...context,
        player: {
          ...context.player,
          resources: {
            oilGas: dossierLevel(p.resources.oilGas),
            food: dossierLevel(p.resources.food),
            rareEarths: dossierLevel(p.resources.rareEarths),
            industrialBase: dossierLevel(p.resources.industrialBase),
          },
          startingSignals: {
            economicStability: dossierSignalFromEstimated(
              args.indicators.economicStability.estimatedValue,
              args.indicators.economicStability.confidence,
            ),
            legitimacy: dossierSignalFromEstimated(args.indicators.legitimacy.estimatedValue, args.indicators.legitimacy.confidence),
            unrest: dossierSignalFromEstimated(args.indicators.unrestLevel.estimatedValue, args.indicators.unrestLevel.confidence, {
              invert: true,
            }),
            intelClarity: dossierSignalFromEstimated(
              args.indicators.intelligenceClarity.estimatedValue,
              args.indicators.intelligenceClarity.confidence,
            ),
          },
        },
      },
      null,
      2,
    ),
    "",
    "Return JSON matching this shape (example keys/types):",
    JSON.stringify(
      {
        name: canon.name,
        geographySummary: "2–4 sentences (string)",
        neighbors: canon.neighbors,
        regimeType: canon.regimeType,
        resources: { oilGas: "low", food: "moderate", rareEarths: "critical", industrialBase: "high" },
        startingAssessment: {
          economicStability: { level: "moderate", confidence: "med", note: "short optional note" },
          legitimacy: { level: "low", confidence: "med", note: "short optional note" },
          unrest: { level: "moderate", confidence: "low", note: "short optional note" },
          intelClarity: { level: "low", confidence: "med", note: "short optional note" },
        },
        vulnerabilities: ["string", "string", "string", "string"],
        generatedBy: "llm",
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmCountryProfileSchema",
    validate: (obj) => LlmCountryProfileSchema.parse(obj),
    temperature: 0.6,
  });

  if (data.name !== canon.name) throw new Error("LLM countryProfile mismatch: name");
  if (data.regimeType !== canon.regimeType) throw new Error("LLM countryProfile mismatch: regimeType");
  if (data.neighbors.join("|") !== canon.neighbors.join("|")) throw new Error("LLM countryProfile mismatch: neighbors");

  return { countryProfile: data as unknown as CountryProfile, llmRaw: raw };
}

export async function llmSuggestDirectives(args: { world: WorldState }): Promise<{ data: z.infer<typeof LlmSuggestDirectiveSchema>; llmRaw: unknown }> {
  const system = [
    "You are an elite policy planner for the head of state in a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Keep suggestions actionable and phrased as directives the player can type.",
    "No raw numbers or scores. Use qualitative language (low/moderate/high/critical) if needed.",
    "Do not contradict the provided context.",
    "HARD LIMITS: suggestions must be 3-7 items. keyDevelopments must be 2-6 items. redFlags up to 6. questions up to 5. Do not exceed these counts.",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const user = [
    "CONTEXT (qualitative only):",
    JSON.stringify(context, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        situation: { headline: "string", keyDevelopments: ["string"] },
        suggestions: ["string"],
        redFlags: ["string"],
        questions: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmSuggestDirectiveSchema",
    validate: (obj) => {
      // Be forgiving on count overruns (common LLM failure mode). Truncate, then validate.
      if (typeof obj !== "object" || obj === null) return LlmSuggestDirectiveSchema.parse(obj);
      const o = obj as Record<string, unknown>;
      const situation = (typeof o.situation === "object" && o.situation !== null ? (o.situation as Record<string, unknown>) : {}) as Record<
        string,
        unknown
      >;
      const keyDevelopments = Array.isArray(situation.keyDevelopments) ? situation.keyDevelopments.slice(0, 6) : situation.keyDevelopments;
      const suggestions = Array.isArray(o.suggestions) ? o.suggestions.slice(0, 7) : o.suggestions;
      const redFlags = Array.isArray(o.redFlags) ? o.redFlags.slice(0, 6) : o.redFlags;
      const questions = Array.isArray(o.questions) ? o.questions.slice(0, 5) : o.questions;
      const normalized = {
        ...o,
        situation: { ...situation, keyDevelopments },
        suggestions,
        redFlags,
        questions,
      };
      return LlmSuggestDirectiveSchema.parse(normalized);
    },
    temperature: 0.6,
  });

  return { data, llmRaw: raw };
}

export async function llmGenerateResolution(args: {
  turnNumber: number;
  directive?: string;
  translatedActions: Array<{ kind: string; summary: string }>;
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  worldBefore: WorldState;
  worldAfter: WorldState;
}): Promise<{ data: z.infer<typeof LlmResolutionSchema>; llmRaw: unknown }> {
  const system = [
    "You write the end-of-turn resolution briefing for a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Make the player's directive impact EXTREMELY obvious: connect directive fragments -> translated ops -> observed effects.",
    "Use specific, grounded intelligence language. No fantasy.",
    "Do NOT reveal internal raw state dumps.",
    "You MAY reference the provided deltas (numbers) directly, because they are player-facing scores.",
    "Hard constraint: do NOT contradict SCORE_DELTAS. If a stat delta is +0, do not imply it worsened/improved.",
    "Hard constraint: explicitly mention (by label) the 2–4 largest absolute SCORE_DELTAS in the narrative, including the signed number in parentheses, e.g. 'Economic stability (-4)'.",
    "If the deltas look counterintuitive, explain *why* (timing lags, second-order effects, credibility costs, etc) rather than handwaving.",
    "Hard constraint: perceptions must be 2–8 items. Each perceptions[].read MUST be <= 160 characters.",
    "Hard constraint: directiveImpact must be 2–8 items.",
    "Narrative MUST include forward-looking second-order impacts over the next 6 months.",
    "Narrative format requirement: include these labeled time blocks as separate lines:",
    "- NEXT 72 HOURS:",
    "- 2–4 WEEKS:",
    "- 2–3 MONTHS:",
    "- 4–6 MONTHS:",
    "Each time block line must include at least one concrete impact on: economy, domestic politics, security/war, or external posture.",
    "Minimum narrative length: 10 lines. Maximum: 18 lines.",
  ].join("\n");

  const user = [
    `TURN_RESOLVED: ${args.turnNumber}`,
    "",
    "PLAYER_DIRECTIVE (may be empty):",
    args.directive?.trim() ? args.directive.trim() : "(none)",
    "",
    "TRANSLATED_ACTIONS (what the system executed):",
    JSON.stringify(args.translatedActions, null, 2),
    "",
    "SCORE_DELTAS (player-facing):",
    JSON.stringify(args.deltas, null, 2),
    "",
    "ACTOR_SHIFTS (perceptions):",
    JSON.stringify(args.actorShifts, null, 2),
    "",
    "TOP_THREATS (derived):",
    JSON.stringify(args.threats, null, 2),
    "",
    "WORLD_CONTEXT_BEFORE (qualitative summary):",
    JSON.stringify(summarizeWorldForLlm(args.worldBefore), null, 2),
    "",
    "WORLD_CONTEXT_AFTER (qualitative summary):",
    JSON.stringify(summarizeWorldForLlm(args.worldAfter), null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        headline: "string",
        narrative: ["string"],
        directiveImpact: [
          { directiveFragment: "string", translatedOps: ["string"], observedEffects: ["string"] },
        ],
        perceptions: [{ actor: "string", posture: "hostile|neutral|friendly", read: "string" }],
        threats: ["string"],
        nextMoves: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmResolutionSchema",
    validate: (obj) => {
      // Be forgiving on common LLM failure modes: too many items / overly long lines.
      if (typeof obj !== "object" || obj === null) return LlmResolutionSchema.parse(obj);
      const o = obj as Record<string, unknown>;
      const safeStr = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const safeStrArr = (v: unknown, maxItems: number, maxLen: number) =>
        Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => String(s).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];

      const narrative = Array.isArray(o.narrative)
        ? o.narrative
            .filter((x) => typeof x === "string")
            .map((s) => String(s).slice(0, 220))
            .slice(0, 18)
        : o.narrative;
      const threatsArr = safeStrArr(o.threats, 7, 180);
      const nextMovesArr = safeStrArr(o.nextMoves, 6, 200);

      // Normalize perceptions objects + enforce max read length.
      const perceptionsRaw = Array.isArray(o.perceptions) ? o.perceptions.slice(0, 8) : [];
      const perceptionsArr = perceptionsRaw
        .map((p) => {
          if (typeof p !== "object" || p === null) return null;
          const pr = p as Record<string, unknown>;
          const actor = safeStr(pr.actor, 40) || "—";
          const posture = safeStr(pr.posture, 12).toLowerCase();
          const read = safeStr(pr.read, 160);
          const okPosture = posture === "hostile" || posture === "neutral" || posture === "friendly" ? posture : "neutral";
          if (!read) return null;
          return { actor, posture: okPosture, read };
        })
        .filter(Boolean) as Array<{ actor: string; posture: "hostile" | "neutral" | "friendly"; read: string }>;

      // Pad perceptions to min 2 using real actor shifts if needed.
      while (perceptionsArr.length < 2) {
        const s = args.actorShifts[perceptionsArr.length];
        if (s) {
          const trustDir = s.trustDelta > 0 ? "trust improved" : s.trustDelta < 0 ? "trust eroded" : "trust held";
          const escDir =
            s.escalationDelta > 0 ? "escalation appetite increased" : s.escalationDelta < 0 ? "escalation appetite cooled" : "escalation posture steady";
          perceptionsArr.push({
            actor: String(s.actor).slice(0, 40),
            posture: (String(s.posture).toLowerCase() as "hostile" | "neutral" | "friendly") ?? "neutral",
            read: `${trustDir}; ${escDir}. Messaging will reflect internal constraints.`,
          });
          continue;
        }
        perceptionsArr.push({
          actor: "Foreign desks",
          posture: "neutral",
          read: "Outside capitals are waiting for confirmation and testing your red lines quietly.",
        });
      }

      // Normalize directiveImpact + pad to min 2.
      const diRaw = Array.isArray(o.directiveImpact) ? o.directiveImpact.slice(0, 8) : [];
      const directiveImpactArr = diRaw
        .map((it) => {
          if (typeof it !== "object" || it === null) return null;
          const r = it as Record<string, unknown>;
          const directiveFragment = safeStr(r.directiveFragment, 120);
          const translatedOps = safeStrArr(r.translatedOps, 4, 140);
          const observedEffects = safeStrArr(r.observedEffects, 5, 160);
          if (!directiveFragment || observedEffects.length === 0) return null;
          return { directiveFragment, translatedOps, observedEffects };
        })
        .filter(Boolean) as Array<{ directiveFragment: string; translatedOps: string[]; observedEffects: string[] }>;

      const topDelta = [...args.deltas]
        .filter((d) => Number.isFinite(d.delta) && d.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 4)
        .map((d) => `${d.label} (${d.delta >= 0 ? "+" : ""}${d.delta})`);
      const ops = args.translatedActions.map((a) => a.summary).slice(0, 4);
      while (directiveImpactArr.length < 2) {
        if (directiveImpactArr.length === 0) {
          directiveImpactArr.push({
            directiveFragment: args.directive?.trim()?.slice(0, 120) || "Primary directive",
            translatedOps: ops.slice(0, 2),
            observedEffects: topDelta.length ? topDelta.slice(0, 3) : ["Immediate effects are visible, but second-order costs are still forming."],
          });
        } else {
          directiveImpactArr.push({
            directiveFragment: "Second-order effects",
            translatedOps: ops.slice(2, 4),
            observedEffects: topDelta.length ? topDelta.slice(-2) : ["Delayed effects will land across financing, legitimacy, and external posture."],
          });
        }
      }

      // Ensure threats/nextMoves meet minimums.
      const threats = threatsArr.length ? threatsArr : args.threats.slice(0, 7);
      while (threats.length < 2) threats.push("Pressure vector: external reactions remain fluid.");
      const nextMoves = nextMovesArr.length ? nextMovesArr : ["Clarify intent publicly with a bounded message.", "Harden logistics and financing against retaliation."];

      const narrativeArr = Array.isArray(narrative) ? (narrative as string[]) : [];
      const trimmedNarrative = narrativeArr.map((s) => String(s).trim()).filter(Boolean);

      const ensureLine = (prefix: string, fallback: string) => {
        if (!trimmedNarrative.some((s) => s.startsWith(prefix))) trimmedNarrative.push(`${prefix} ${fallback}`.slice(0, 220));
      };

      // Enforce time blocks even if the model forgets.
      ensureLine("NEXT 72 HOURS:", "Immediate reactions: messaging hardens; markets reprice risk; security posture tightens.");
      ensureLine("2–4 WEEKS:", "Second-order effects: protests and countermeasures; financing pressure; escalation control becomes harder.");
      ensureLine("2–3 MONTHS:", "Lagged impacts: inflation and debt stress bite; elite fractures widen; external actors set conditions.");
      ensureLine("4–6 MONTHS:", "Compounding costs: sustained readiness strains economy; legitimacy erosion risks ouster dynamics.");

      // Pad to a detailed minimum so the narrative box isn't sparse.
      while (trimmedNarrative.length < 12) {
        const extra = topDelta.length
          ? `Assessment: key metrics moving: ${topDelta.slice(0, 3).join(", ")}. Expect spillover across legitimacy, financing, and posture.`
          : "Assessment: effects are visible but uncertainty remains; expect lagged economic and political consequences.";
        trimmedNarrative.push(extra.slice(0, 220));
      }

      const normalized = {
        ...o,
        narrative: trimmedNarrative.slice(0, 18),
        threats: threats.slice(0, 7),
        nextMoves: nextMoves.slice(0, 6),
        perceptions: perceptionsArr.slice(0, 8),
        directiveImpact: directiveImpactArr.slice(0, 8),
      };
      return LlmResolutionSchema.parse(normalized);
    },
    temperature: 0.6,
  });

  return { data, llmRaw: raw };
}

export async function llmGenerateWorldGenScenario(args: {
  seedHint: string;
  candidateLocations: Array<{ lat: number; lon: number }>;
}): Promise<{ data: z.infer<typeof LlmWorldGenScenarioSchema>; llmRaw: unknown }> {
  const system = [
    "You generate the starting country/location for a grounded geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "The goal is GLOBAL VARIETY across runs. Do not default to the Eastern Mediterranean, West Africa, or Southeast Asia unless the provided coordinates strongly indicate it.",
    "Choose ONE candidate location. If the coordinate is in open ocean, you may snap to the nearest landmass within ~400km and adjust lat/lon slightly.",
    "Make the result plausible: neighbors should match the chosen part of the world (use real neighboring countries).",
    "The player country name should be fictional but believable for the region (not a real country name).",
    "No fantasy, no sci-fi, no supernatural. Keep it modern and realistic.",
    "Do NOT output any numeric scores/indices besides lat/lon.",
  ].join("\n");

  const user = [
    `SEED_HINT: ${args.seedHint}`,
    "",
    "CANDIDATE_LOCATIONS (choose one; may snap slightly to land):",
    JSON.stringify(args.candidateLocations, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        location: { lat: 12.34, lon: 56.78, regionLabel: "string" },
        player: {
          name: "string (fictional country name)",
          geographySummary: "2–5 sentences, grounded and specific",
          neighbors: ["string", "string"],
          regimeType: "democracy|hybrid|authoritarian",
        },
        regionalPowers: ["string", "string"],
        notes: ["optional short strings"],
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmWorldGenScenarioSchema",
    validate: (obj) => LlmWorldGenScenarioSchema.parse(obj),
    temperature: 0.8,
  });

  // Defensive normalization
  const neighbors = Array.from(new Set(data.player.neighbors.map((s) => s.trim()).filter(Boolean))).slice(0, 6);
  const regionalPowers = [data.regionalPowers[0].trim(), data.regionalPowers[1].trim()] as [string, string];
  return {
    data: {
      ...data,
      player: { ...data.player, neighbors },
      regionalPowers,
    },
    llmRaw: raw,
  };
}

export async function llmGenerateControlRoomView(args: {
  snapshot: GameSnapshot;
  world: WorldState;
  memory: Array<{
    turn: number;
    resolutionHeadline?: string;
    continuityNotes?: string[];
    controlRoom?: unknown;
  }>;
}): Promise<{ data: z.infer<typeof LlmControlRoomViewSchema>; llmRaw: unknown }> {
  const canon = {
    turn: args.snapshot.turn,
    country: args.snapshot.countryProfile.name,
    neighbors: args.snapshot.countryProfile.neighbors,
    regimeType: args.snapshot.countryProfile.regimeType,
  };

  const system = [
    "You are generating the player-facing Control Room dashboard state for a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Make the dashboard feel like intelligence: terse labels, meaningful weights, and grounded regions.",
    "You MUST NOT contradict the provided canonical turn/country/neighbors/regimeType.",
    "All numeric widgets MUST be within bounds (0-100 for indices; 0..1 for intensities).",
    "Use colors as hex (#RRGGBB). Use 3-8 hotspots, 4-10 signals, 4-14 briefing items.",
    "Also generate map overlays (clustersByMode) so each mode shows different regions:",
    "- pressure: where stress is concentrated",
    "- narrative: where info/propaganda attention is spiking",
    "- entanglement: where interdependence/leverage ties are tightest",
    "- sentiment: where attitudes toward the player are most hostile/volatile (red) or friendly (green).",
    "Your output should reflect continuity with prior turns (memory).",
  ].join("\n");

  const user = [
    "CANONICAL (must match):",
    JSON.stringify(canon, null, 2),
    "",
    "PLAYER-FACING SNAPSHOT (current turn):",
    JSON.stringify(
      {
        turn: args.snapshot.turn,
        countryProfile: args.snapshot.countryProfile,
        indicators: args.snapshot.playerView.indicators,
        incomingEvents: args.snapshot.playerView.incomingEvents,
        briefing: args.snapshot.playerView.briefing,
      },
      null,
      2,
    ),
    "",
    "WORLD CONTEXT (qualitative only):",
    JSON.stringify(summarizeWorldForLlm(args.world), null, 2),
    "",
    "MEMORY (recent turns, may be empty):",
    JSON.stringify(args.memory, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        pressure: {
          pressureIndex: 67,
          deltaPerTurn: 3,
          narrativeGravity: 72,
          systemStrain: 59,
          note: "string (optional)",
        },
        hotspots: [{ id: "string", region: "string", value: 70, trend: "up", color: "#dc2626", why: "optional" }],
        signals: [{ id: "string", label: "string", intensity: 0.4, confidence: "MED", why: "optional" }],
        briefings: [{ id: "string", timestamp: "now", source: "Markets", content: "string" }],
        map: {
          homeRegion: { lat: 14.5, lon: 105.0 },
          clustersByMode: {
            pressure: [{ id: "home", lat: 14.5, lon: 105.0, intensity: "med", radius: 40, dotCount: 18 }],
            narrative: [{ id: "info", lat: 22.0, lon: 114.0, intensity: "high", radius: 50, dotCount: 22 }],
            entanglement: [{ id: "trade", lat: 1.3, lon: 103.8, intensity: "med", radius: 45, dotCount: 16 }],
            sentiment: [{ id: "hostile-capital", lat: 55.7, lon: 37.6, intensity: "high", radius: 45, dotCount: 20 }],
          },
          fogRegions: [{ lat: 20.0, lon: 120.0, radius: 18 }],
        },
        generatedBy: "llm",
        memory: { previousTurnsUsed: 2, continuityNotes: ["optional"] },
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmControlRoomViewSchema",
    validate: (obj) => LlmControlRoomViewSchema.parse(obj),
    temperature: 0.55,
  });

  return { data, llmRaw: raw };
}

function summarizeWorldForLlm(world: WorldState) {
  const p = world.player;
  return {
    turn: world.turn,
    player: {
      name: p.name,
      regimeType: p.regimeType,
      geography: p.geographySummary,
      neighbors: p.neighbors,
      economy: {
        stability: bucket(p.economy.economicStability),
        inflation: bucket(p.economy.inflationPressure),
        debt: bucket(p.economy.debtStress),
      },
      politics: {
        legitimacy: bucket(p.politics.legitimacy),
        eliteCohesion: bucket(p.politics.eliteCohesion),
        militaryLoyalty: bucket(p.politics.militaryLoyalty),
        unrest: bucket(p.politics.unrest),
        sovereigntyIntegrity: bucket(p.politics.sovereigntyIntegrity),
        sanctionsActive: world.global.sanctionsRegimeActive,
      },
      military: {
        readiness: bucket(p.military.readiness),
        logistics: bucket(p.military.logistics),
      },
    },
    global: {
      attention: bucket(world.global.attentionLevel),
      trade: bucket(world.global.globalTradeTemperature),
      energy: bucket(world.global.globalEnergyMarketTightness),
    },
    conflicts: world.conflicts.map((c) => ({
      name: c.name,
      escalation: c.escalationLevel,
      attrition: bucket(c.attrition),
      insurgencyRisk: bucket(c.insurgencyRisk),
    })),
    actors: Object.values(world.actors).map((a) => ({
      id: a.id,
      name: a.name,
      posture: a.postureTowardPlayer,
      trust: bucket(a.trust),
      willingnessToEscalate: bucket(a.willingnessToEscalate),
      sanctionsPolicy: bucket(a.sanctionsPolicyStrength),
    })),
  };
}

function bucket(v: number): "critical" | "low" | "moderate" | "high" {
  if (v >= 75) return "high";
  if (v >= 55) return "moderate";
  if (v >= 35) return "low";
  return "critical";
}

function leaksNumbers(s: string): boolean {
  // Disallow obvious score leaks like "72/100" or "45 out of 100"
  if (/\b\d{1,3}\s*\/\s*100\b/.test(s)) return true;
  if (/\b\d{1,3}\s+(out of)\s+100\b/i.test(s)) return true;
  return false;
}

export async function llmChat(args: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    return chatTextGemini(args);
  }
  if (process.env.OPENAI_API_KEY) {
    return chatTextOpenAI(args);
  }
  throw new Error("No LLM API keys configured");
}

async function chatTextGemini(args: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      generationConfig: { temperature: args.temperature ?? 0.7 },
    }),
  });

  const payload: GeminiGenerateContentResponse = await res.json().catch(() => ({} as GeminiGenerateContentResponse));
  if (!res.ok) throw new Error(payload.error?.message || `Gemini error (${res.status})`);

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Gemini returned no text content");
  return text;
}

async function chatTextOpenAI(args: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY!;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      temperature: args.temperature ?? 0.7,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });

  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI error (${res.status})`);

  return extractChatContent(payload);
}
