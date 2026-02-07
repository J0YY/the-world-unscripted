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
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ briefing: WorldState["current"]["briefing"]; events: IncomingEvent[]; llmRaw: unknown }> {
  const system = [
    "You are the turn generator for a grounded geopolitical simulation.",
    "Tone: unsentimental, Reuters/cabinet memo style, operational language.",
    "Output MUST be strict JSON object only.",
    "You must generate: briefing + 2-5 incoming events.",
    "NON-NEGOTIABLE SPECIFICITY:",
    "- Every item in briefing.headlines, briefing.domesticRumors, briefing.diplomaticMessages, and briefing.intelBriefs[].text MUST mention at least one specific proper noun from the provided context: the player country name, a named neighbor, or a named external actor.",
    "- At least 2 items must mention a neighbor by name.",
    "- At least 2 items must mention an external actor by name AND reflect their posture toward the player (friendly/neutral/hostile) using the context buckets.",
    "- Tie items to what happened last turn: reference LAST_TURN_PUBLIC_RESOLUTION and RECENT_TURNS_MEMORY as causal background (without quoting scores).",
    "- Avoid generic filler like 'price controls are being discussed' unless you name the institution/actor pushing it (central bank, finance ministry, ruling party caucus, major importer, port authority, etc.).",
    "Hard constraints:",
    "- Include at least 1 international development, 1 domestic development, and 1 intelligence note with uncertainty.",
    "- Do NOT include any numeric ratings/scores (no '72/100', no indices). Use qualitative buckets only: critical/low/moderate/high.",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Events must be plausible: sanctions, protests, leaks, border incidents, interdictions, IMF contact, cyber incidents, insurgent attacks.",
    "- Event effects must be modest and bounded; use the provided keys only.",
  ].join("\n");

  const context = summarizeWorldForLlm(args.world);
  const memory = Array.isArray(args.memory) ? args.memory.slice(-3) : [];
  const user = [
    `PHASE: ${args.phase}`,
    args.playerDirective ? `PLAYER_DIRECTIVE: ${args.playerDirective}` : "PLAYER_DIRECTIVE: (none)",
    args.lastTurnPublicResolution ? `LAST_TURN_PUBLIC_RESOLUTION:\n${args.lastTurnPublicResolution}` : "",
    memory.length ? `RECENT_TURNS_MEMORY:\n${JSON.stringify(memory, null, 2)}` : "RECENT_TURNS_MEMORY: []",
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

  const names = [
    context.player.name,
    ...(Array.isArray(context.player.neighbors) ? context.player.neighbors : []),
    ...(Array.isArray(context.actors) ? context.actors.map((a) => a.name) : []),
  ]
    .filter((x) => typeof x === "string")
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 24);

  const mentionsAny = (s: string) => {
    const t = s.toLowerCase();
    return names.some((n) => n.length >= 3 && t.includes(n.toLowerCase()));
  };

  const validateTurnPkg = (obj: unknown) => {
    const parsed = LlmGenerateTurnPackageSchema.parse(obj);
    // Safety: fail closed if model leaks obvious numeric truth patterns into player-visible text.
    if (leaksNumbers(parsed.briefing.text)) throw new Error("LLM briefing leaked numeric scoring; disabled for this turn");

    const allLines: string[] = [
      ...parsed.briefing.headlines,
      ...parsed.briefing.domesticRumors,
      ...parsed.briefing.diplomaticMessages,
      ...parsed.briefing.intelBriefs.map((b) => b.text),
    ];
    const missing = allLines.filter((l) => !mentionsAny(String(l)));
    if (missing.length) {
      throw new Error("Briefing too generic: some lines did not mention player/neighbor/actor names from context.");
    }
    const neighbors = Array.isArray(context.player.neighbors) ? context.player.neighbors : [];
    const neighborMentions = allLines.filter((l) => neighbors.some((n) => String(l).toLowerCase().includes(String(n).toLowerCase())));
    if (neighbors.length && neighborMentions.length < 2) {
      throw new Error("Briefing missing neighbor-specific items (need >=2 neighbor mentions).");
    }
    const actorNames = Array.isArray(context.actors) ? context.actors.map((a) => a.name) : [];
    const actorMentions = allLines.filter((l) => actorNames.some((n) => String(l).toLowerCase().includes(String(n).toLowerCase())));
    if (actorNames.length && actorMentions.length < 2) {
      throw new Error("Briefing missing actor-specific items (need >=2 external actor mentions).");
    }
    return parsed;
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : [
              "",
              "REPAIR MODE:",
              "Your previous output was rejected for being too generic.",
              "Regenerate the ENTIRE JSON, keeping the same schema, but ensure every line contains specific names from context.",
              lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : "",
            ].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user,
        schemaName: attempt === 0 ? "LlmGenerateTurnPackageSchema" : "LlmGenerateTurnPackageSchema_retry",
        validate: validateTurnPkg,
        temperature: attempt === 0 ? 0.85 : 0.55,
      });

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
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM turn package failed");

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
    "- ALLIANCE / BLOC INTENT: If the directive asks to 'form an alliance bloc' / 'create an alliance' with multiple named countries, represent it as 1–2 DIPLOMACY actions (usually TREATY_PROPOSAL + MESSAGE/OFFER).",
    "  Use REGIONAL_1/REGIONAL_2 as proxies for local partners unless an explicit actor id is mentioned; include the named countries verbatim in your rationale strings.",
    "- CRITICAL: Do NOT choose any MILITARY action unless the directive contains an explicit kinetic/force verb (attack, strike, bomb, invade, annex, occupy, seize, conquer, war) OR an explicit force-prep verb (mobilize, deploy troops, call up reserves, defensive posture).",
    "  Phrases like 'territorial gain', 'secure leverage', 'pressure them', or 'be strong' are NOT sufficient to justify a strike/invasion. Map those to diplomacy/intel/institutions instead.",
    "- If the directive asks for investment/FDI/tech sector deals with a named major power (e.g., China), include ECONOMY: TRADE_DEAL_ATTEMPT with targetActor set to that actor when possible.",
    "- If the directive asks to spy/surveil/infiltrate a named country that is not an actor id, still choose INTEL (SURVEILLANCE or COVERT_OP) and mention the country name in rationale.",
    "- If the directive offers intel/tradecraft to a counterpart (e.g., 'offer to spy on India' to China), model it as DIPLOMACY: OFFER with topic=intel to that counterpart, plus an INTEL action if slots allow.",
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
  let validated = PlayerActionSchema.array().parse(actions);

  // Safety rail: prevent accidental military actions from vague language.
  const d = args.directive.toLowerCase();
  const explicitKinetic = /\b(attack|strike|bomb|invade|annex|occupy|seize|conquer|war)\b/.test(d);
  const explicitForcePrep = /\b(mobiliz(e|ation)|deploy|troops|call up|reserves|defensive posture)\b/.test(d);
  const allowMilitary = explicitKinetic || explicitForcePrep;
  if (!allowMilitary) {
    const guessTargetActor = () => {
      const entries = Object.entries(args.world.actors) as Array<[keyof typeof args.world.actors, (typeof args.world.actors)[keyof typeof args.world.actors]]>;
      for (const [id, actor] of entries) {
        const name = actor.name.toLowerCase();
        const tokens = name.split(/\s+/).filter(Boolean);
        if (tokens.some((t) => t.length >= 4 && d.includes(t))) return id;
        if (d.includes(name)) return id;
      }
      return "REGIONAL_1" as const;
    };
    const targetActor = guessTargetActor();
    const replaced: PlayerAction[] = [];
    let changed = false;
    for (const a of validated) {
      if (a.kind !== "MILITARY") {
        replaced.push(a);
        continue;
      }
      changed = true;
      replaced.push({
        kind: "DIPLOMACY",
        subkind: "MESSAGE",
        targetActor,
        topic: "security",
        tone: "firm",
        intensity: 2,
        isPublic: false,
      });
    }
    if (changed) validated = replaced.slice(0, Math.max(1, args.remainingSlots));
  }

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
  const extractCoalitionPartners = (directive: string): string[] => {
    const d = String(directive || "");
    const out: string[] = [];
    const grab = (m: RegExpMatchArray | null) => {
      if (!m?.[1]) return;
      const raw = String(m[1]).trim();
      if (!raw) return;
      // Split on common separators, keep plausible country/actor phrases.
      const parts = raw
        .split(/,|;|\/|&|\band\b/gi)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      for (const p of parts) {
        let cleaned = p.replace(/^the\s+/i, "").replace(/[.]+$/g, "").trim();
        // Strip trailing region clauses like "Uzbekistan in southwest asia".
        // Keep this conservative: only strip when the suffix looks like a region descriptor.
        cleaned = cleaned.replace(/\s+in\s+(southwest|south|central|southeast|north|east|west)\s+asia\b/i, "").trim();
        cleaned = cleaned.replace(/\s+in\s+(europe|africa|asia|the middle east|middle east|latin america)\b/i, "").trim();
        if (!cleaned) continue;
        if (cleaned.length > 48) continue;
        out.push(cleaned);
      }
    };
    grab(d.match(/\bin conjunction with\s+([^.\n]+)/i));
    grab(d.match(/\balongside\s+([^.\n]+)/i));
    grab(d.match(/\bwith support from\s+([^.\n]+)/i));
    grab(d.match(/\bform an alliance bloc with\s+([^.\n]+)/i));
    grab(d.match(/\balliance bloc with\s+([^.\n]+)/i));
    grab(d.match(/\bform an alliance with\s+([^.\n]+)/i));
    grab(d.match(/\bform alliance with\s+([^.\n]+)/i));
    grab(d.match(/\balliance with\s+([^.\n]+)/i));
    grab(d.match(/\bcoalition with\s+([^.\n]+)/i));
    // De-dupe, keep order.
    return Array.from(new Set(out)).slice(0, 3);
  };

  const coalitionPartners = args.directive ? extractCoalitionPartners(args.directive) : [];

  const extractDirectiveIntents = (directive: string) => {
    const d = String(directive || "").trim();
    if (!d) return [];
    const parts = d
      .split(/\n|;|,|\band then\b|\bthen\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const picked: string[] = [];
    for (const p of parts) {
      if (picked.length >= 4) break;
      const short = p.length > 140 ? p.slice(0, 140) : p;
      picked.push(short);
    }
    return picked.length ? picked : [d.slice(0, 140)];
  };

  const directiveIntents = args.directive ? extractDirectiveIntents(args.directive) : [];

  const isBadWhenHighLabel = (label: string) => {
    const l = String(label || "").toLowerCase();
    return (
      l.includes("unrest") ||
      l.includes("inflation") ||
      l.includes("debt") ||
      l.includes("strain") ||
      l.includes("pressure") ||
      l.includes("corruption")
    );
  };

  const qualitativeDelta = (d: { label: string; delta: number }) => {
    const abs = Math.abs(d.delta);
    const intensity = abs >= 10 ? "sharply" : abs >= 5 ? "notably" : "slightly";
    const badWhenHigh = isBadWhenHighLabel(d.label);
    const improved = badWhenHigh ? d.delta < 0 : d.delta > 0;
    const verb = improved ? "improved" : "deteriorated";
    return `${d.label} ${verb} ${intensity}`.trim();
  };

  const extractTargetFromSummary = (summary: string): string | null => {
    const s = String(summary || "");
    const m1 = s.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40})/i);
    if (m1?.[1]) return m1[1].trim();
    const m2 = s.match(/\bagainst\s+([A-Za-z][A-Za-z .'-]{1,40})/i);
    if (m2?.[1]) return m2[1].trim();
    return null;
  };

  const paraphraseAction = (a: { kind: string; summary: string }): string => {
    const kind = String(a.kind || "").toUpperCase();
    const target = extractTargetFromSummary(a.summary) || "the target state";
    switch (kind) {
      case "LIMITED_STRIKE":
        return `Carried out a short, high-precision strike package against ${target} (selected military/logistics nodes; calibrated to signal capability without committing to a full campaign).`;
      case "FULL_INVASION":
        return `Pushed a combined-arms offensive into ${target}, attempting to seize terrain and force political capitulation through sustained pressure.`;
      case "MOBILIZE":
        return `Activated a surge posture: reserve call-ups, unit repositioning, logistics activation, and internal security tightening tied to ${target}.`;
      case "PROXY_SUPPORT":
        return `Expanded deniable support to aligned networks connected to ${target} (financing, materiel, and advisors routed through intermediaries).`;
      case "ARMS_PURCHASE":
        return `Accelerated emergency procurement and resupply linked to operations around ${target}, prioritizing munitions, ISR, and sustainment.`;
      case "SURVEILLANCE":
        return `Increased ISR coverage and targeting collection focused on ${target} (signals, overhead, and HUMINT tasking) to reduce uncertainty.`;
      case "COUNTERINTEL":
        return `Ordered a counterintelligence sweep to disrupt hostile penetration and leaks associated with ${target}-related operations.`;
      case "COVERT_OP":
        return `Ran a deniable disruption operation tied to ${target} (pressure points selected for leverage rather than visibility).`;
      default:
        return `Executed a calibrated coercive action linked to ${target}, emphasizing control of escalation and narrative discipline.`;
    }
  };

  const actionsForLlm = args.translatedActions.map(paraphraseAction).slice(0, 6);
  const qualitativeTopDeltas = [...args.deltas]
    .filter((d) => Number.isFinite(d.delta) && d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
    .map((d) => qualitativeDelta({ label: d.label, delta: d.delta }));

  const system = [
    "You write the end-of-turn resolution briefing for a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Write like a classified after-action memo: specific, operational, grounded. No fantasy.",
    "PRIMARY OBJECTIVE: directly address the player's directive. The first 3 narrative lines must explicitly reference the directive's concrete asks (names, offers, requests).",
    "You MUST cover every item in DIRECTIVE_INTENTS somewhere in the narrative (verbatim or close paraphrase).",
    "Be concrete and decisive. Avoid hedging words like 'may', 'might', 'could', 'likely' anywhere (including forecasts). Use firm projections ('will', 'expect', 'is set to') instead.",
    "Do NOT reveal internal raw state dumps.",
    "DO NOT mention any internal action classifications, enum names, or parameters (no 'LIMITED_STRIKE', no 'MOBILIZE', no 'intensity').",
    "DO NOT mention scores, indices, deltas, or any numeric rating changes in the narrative. Keep it in-world.",
    "You may use the provided deltas/actions only as hidden guidance to stay consistent, but never quote them.",
    "Do not use game-y button language like 'public/private', 'limited strike', or 'mobilization' as labels. Describe concrete actions (what moved, what was hit, what was announced, what was denied).",
    "Your narrative must state what happened, who escalated/de-escalated, what failed/held, and at least one political 'fall' (cabinet collapse, minister resignation, command shake-up, government crisis) IF domestic unrest/legitimacy worsened in the hidden guidance.",
    "If there was no sustained ground campaign, do NOT claim an entire country 'fell'. Instead describe partial collapses (local authority breakdown, party fracture, minister ouster, security services shake-up).",
    "Include at least 2 named places (cities, border crossings, ports, bases) relevant to the involved countries, and at least 2 external actors by name from PERCEPTIONS/THREATS.",
    "Avoid abstract/meta phrasing ('strategic locations', 'managing escalation', 'controlling the narrative', 'focused on'). Replace with tangible events grounded in WORLD_CONTEXT_BEFORE/AFTER and ACTIONS_TAKEN.",
    "CRITICAL CONSISTENCY: Do NOT invent strikes/invasions/mobilizations unless a MILITARY action was executed this turn.",
    "If COALITION_PARTNERS is non-empty, you MUST explicitly mention at least one partner by name in the resolved-events portion and show what coordination occurred (liaison, deconfliction, joint messaging, basing, logistics).",
    "If outcomes look counterintuitive, explain causality (timing lags, second-order effects, credibility costs) in-world.",
    "Hard constraint: perceptions must be 2–8 items. Each perceptions[].read MUST be <= 160 characters.",
    "Hard constraint: directiveImpact must be 2–8 items.",
    "Narrative MUST include forward-looking second-order impacts over the next 6 months.",
    "Narrative format requirement: include these labeled time blocks as separate lines:",
    "- NEXT 72 HOURS:",
    "- 2–4 WEEKS:",
    "- 2–3 MONTHS:",
    "- 4–6 MONTHS:",
    "Formatting hard rule: include ALL four time-block lines verbatim as prefixes. Easiest: make the FINAL 4 narrative array entries start with those prefixes.",
    "Each time block line must include at least one concrete impact on: economy, domestic politics, security/war, or external posture.",
    "Minimum narrative length: 10 lines. Maximum: 18 lines.",
  ].join("\n");

  const user = [
    `TURN_RESOLVED: ${args.turnNumber}`,
    "",
    "PLAYER_DIRECTIVE (may be empty):",
    args.directive?.trim() ? args.directive.trim() : "(none)",
    "",
    "COALITION_PARTNERS (if any; treat as real actors involved this turn):",
    JSON.stringify(coalitionPartners, null, 2),
    "",
    "DIRECTIVE_INTENTS (must be explicitly addressed):",
    JSON.stringify(directiveIntents, null, 2),
    "",
    "ACTIONS_TAKEN_THIS_TURN (in-world paraphrase; treat as fact for the resolved events):",
    JSON.stringify(actionsForLlm, null, 2),
    "",
    "ACTIONS_RAW (authoritative; do not quote enum labels; use only to stay consistent):",
    JSON.stringify(args.translatedActions, null, 2),
    "",
    "SCORE_DELTAS (hidden guidance; do NOT quote numbers in narrative):",
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

  const validateResolution = (obj: unknown) => {
    if (typeof obj !== "object" || obj === null) return LlmResolutionSchema.parse(obj);
    const o = obj as Record<string, unknown>;
    const safeStr = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const safeStrArr = (v: unknown, maxItems: number, maxLen: number) =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => String(s).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];

    const narrativeArr = Array.isArray(o.narrative)
      ? o.narrative
          .filter((x) => typeof x === "string")
          .map((s) => String(s).slice(0, 220))
          .slice(0, 18)
      : [];

    const scrubLine = (s: string) => {
      let out = s.trim();
      // Keep time-block headings intact (they include digits and dashes).
      if (
        out.startsWith("NEXT 72 HOURS:") ||
        out.startsWith("2–4 WEEKS:") ||
        out.startsWith("2–3 MONTHS:") ||
        out.startsWith("4–6 MONTHS:")
      ) {
        return out.slice(0, 220);
      }
      // Remove obvious internal action labels + numeric scoring leaks.
      out = out.replace(/\b(LIMITED_STRIKE|FULL_INVASION|MOBILIZE|PROXY_SUPPORT|ARMS_PURCHASE|SURVEILLANCE|COUNTERINTEL|COVERT_OP)\b/g, "");
      out = out.replace(/\bintensity\s*\d+\b/gi, "");
      out = out.replace(/\(\s*[+-]?\d+[^)]*\)/g, "").trim();
      out = out.replace(/\s[+-]\d{1,3}\b/g, "").trim();
      out = out.replace(/\b\d{1,3}\s*(points?|pts)\b/gi, "").trim();
      out = out.replace(/\b\d{1,3}\s*\/\s*100\b/g, "").trim();
      // Collapse whitespace.
      out = out.replace(/\s{2,}/g, " ").trim();
      return out;
    };

    const narrative = narrativeArr.map((s) => scrubLine(String(s))).filter((s) => s.length >= 8).slice(0, 18);

    const perceptionsRaw = Array.isArray(o.perceptions) ? o.perceptions.slice(0, 8) : [];
    const perceptions = perceptionsRaw
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

    const diRaw = Array.isArray(o.directiveImpact) ? o.directiveImpact.slice(0, 8) : [];
    const directiveImpact = diRaw
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

    const normalized = {
      headline: safeStr(o.headline, 160),
      narrative,
      directiveImpact,
      perceptions,
      threats: safeStrArr(o.threats, 7, 180),
      nextMoves: safeStrArr(o.nextMoves, 6, 200),
    };

    const parsed = LlmResolutionSchema.parse(normalized);

    // Hard requirements (no seeded fallback): enforce, or fail and retry.
    const hasTimeline =
      parsed.narrative.some((s) => s.startsWith("NEXT 72 HOURS:")) &&
      parsed.narrative.some((s) => s.startsWith("2–4 WEEKS:")) &&
      parsed.narrative.some((s) => s.startsWith("2–3 MONTHS:")) &&
      parsed.narrative.some((s) => s.startsWith("4–6 MONTHS:"));
    if (!hasTimeline) throw new Error("Resolution narrative missing required timeline blocks.");
    if (parsed.narrative.length < 10) throw new Error("Resolution narrative too short (min 10 lines).");

    const kineticKinds = new Set(["LIMITED_STRIKE", "FULL_INVASION", "MOBILIZE", "PROXY_SUPPORT", "ARMS_PURCHASE", "DEFENSIVE_POSTURE"]);
    const allowKinetic = args.translatedActions.some((a) => kineticKinds.has(String(a.kind || "").toUpperCase()));
    if (!allowKinetic) {
      const forbidden = /\b(strike|bomb|invasion|invade|air\s*raid|missile|artillery|mobiliz|reserve call|troop|ground offensive)\b/i;
      if (parsed.narrative.some((s) => forbidden.test(s))) {
        throw new Error("Resolution invented kinetic action despite no MILITARY action executed.");
      }
    }

    return parsed;
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : [
              "",
              "REPAIR MODE:",
              "Your previous response failed validation. Fix it and return ONLY valid JSON.",
              "Do NOT add extra keys. Do NOT add commentary. Follow all narrative constraints exactly.",
              "You MUST include the 4 required time-block lines. Put them as the LAST 4 narrative entries.",
              lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : "",
            ].join("\n");
      const out = await chatJson({
        system: system + extra,
        user,
        schemaName: attempt === 0 ? "LlmResolutionSchema" : "LlmResolutionSchema_retry",
        validate: validateResolution,
        temperature: attempt === 0 ? 0.45 : attempt === 1 ? 0.25 : 0.15,
      });
      return { data: out.data, llmRaw: out.raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM resolution failed");
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
