import type { IncomingEvent, PlayerAction, WorldState } from "@/engine";
import { PlayerActionSchema } from "@/engine";
import { LlmGenerateTurnPackageSchema, LlmParseDirectiveSchema, LlmRewriteTurnSchema } from "./llmSchemas";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export type LlmMode = "OFF" | "ON";

export function llmMode(): LlmMode {
  return (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) ? "ON" : "OFF";
}

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

  const payload: any = await res.json().catch(() => ({}));
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
  const system = [
    "You are a game systems assistant translating player intent into structured actions.",
    "You MUST output strict JSON.",
    "Only produce actions that are plausible for a head of state.",
    "Do not exceed remainingSlots.",
    "Use intensity 1-3. Choose isPublic thoughtfully.",
    "Never output more than remainingSlots actions.",
  ].join("\n");

  const user = [
    `REMAINING_SLOTS: ${args.remainingSlots}`,
    "PLAYER_DIRECTIVE:",
    args.directive,
    "",
    "CONTEXT (qualitative only):",
    JSON.stringify(summarizeWorldForLlm(args.world), null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify({ actions: [PlayerActionSchema.describe("PlayerAction")._def], rationale: ["string"] }),
  ].join("\n");

  const { data, raw } = await chatJson({
    system,
    user,
    schemaName: "LlmParseDirectiveSchema",
    validate: (obj) => LlmParseDirectiveSchema.parse(obj),
    temperature: 0.4,
  });

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
    "You are an Intelligent Agency analyst for the player's country.",
    "Your name is 'Control' or 'Agency'.",
    "You communicate in brief, professional, slightly paranoid intelligence-speak.",
    "You have access to the current world state, but you MUST NOT reveal hidden numeric values (raw 0-100 scores).",
    "Use qualitative terms: low, moderate, high, critical.",
    "If asked about future outcomes, be probabilistic and cautious.",
    "The player is the head of state. Address them as 'Sir', 'Madam', or 'Leader'.",
    "Keep answers under 3 sentences unless asked for a detailed report.",
    "Refuse to predict the exact random number outcomes.",
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

  const payload: any = await res.json().catch(() => ({}));
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
