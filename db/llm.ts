import type { ActorId, CountryProfile, ExternalActorState, ForeignPower, GameSnapshot, IncomingEvent, PlayerAction, WorldState } from "@/engine";
import { PlayerActionSchema } from "@/engine";
import { z } from "zod";
import {
  LlmControlRoomViewSchema,
  LlmCountryProfileSchema,
  LlmGenerateBriefingOnlySchema,
  LlmGenerateBriefingDiplomaticMessagesOnlySchema,
  LlmGenerateBriefingDomesticRumorsOnlySchema,
  LlmGenerateBriefingHeadlinesOnlySchema,
  LlmGenerateBriefingIntelBriefsOnlySchema,
  LlmGenerateBriefingSlimSchema,
  LlmGenerateEventsOnlySchema,
  LlmDiplomacySchema,
  LlmDiplomacyChatResponseSchema,
  LlmParseDirectiveSchema,
  LlmResolutionSchema,
  LlmRewriteTurnSchema,
  LlmSuggestDirectiveSchema,
  LlmWorldGenScenarioSchema,
  LlmInterrogationSchema,
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
  const baseSystem = [
    "You are the turn generator for a grounded geopolitical simulation.",
    "Tone: unsentimental, Reuters/cabinet memo style, operational language.",
    "Output MUST be strict JSON object only.",
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
  const userContext = [
    `PHASE: ${args.phase}`,
    args.playerDirective ? `PLAYER_DIRECTIVE: ${args.playerDirective}` : "PLAYER_DIRECTIVE: (none)",
    args.lastTurnPublicResolution ? `LAST_TURN_PUBLIC_RESOLUTION:\n${args.lastTurnPublicResolution}` : "",
    memory.length ? `RECENT_TURNS_MEMORY:\n${JSON.stringify(memory, null, 2)}` : "RECENT_TURNS_MEMORY: []",
    "",
    "CONTEXT (qualitative only; do not invent numeric scores):",
    JSON.stringify(context, null, 2),
    "",
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

  const validateBriefing = (obj: unknown) => {
    const parsed = LlmGenerateBriefingOnlySchema.parse(obj);
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

  const validateEvents = (obj: unknown) => {
    const parsed = LlmGenerateEventsOnlySchema.parse(obj);
    return parsed;
  };

  type BriefingOnly = z.infer<typeof LlmGenerateBriefingOnlySchema>;
  type EventsOnly = z.infer<typeof LlmGenerateEventsOnlySchema>;

  const temps = [0.85, 0.6, 0.5, 0.4];
  let briefing: BriefingOnly["briefing"] | null = null;
  let eventsData: EventsOnly["events"] | null = null;
  let lastBriefErr: unknown = null;
  let lastEventsErr: unknown = null;
  const llmRawParts: Record<string, unknown> = {};

  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const briefingExtra =
        attempt === 0
          ? ""
          : [
              "",
              "REPAIR MODE (BRIEFING):",
              "Your previous output was rejected for being too generic or invalid.",
              "Regenerate the ENTIRE JSON, keeping the same schema, but ensure every line contains specific names from context.",
              lastBriefErr ? `Validation error: ${String((lastBriefErr as Error)?.message ?? lastBriefErr)}` : "",
            ].join("\n");
      const briefingSystem =
        baseSystem +
        "\n\n" +
        [
          "TASK: Generate briefing only.",
          "Ignore any instructions about events/effects; do NOT output events.",
          "OUTPUT: Return JSON with key 'briefing' ONLY (no events).",
        ].join("\n");
      const briefingUser = [
        userContext,
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
          },
          null,
          2,
        ),
      ].join("\n");

      const eventsExtra =
        attempt === 0
          ? ""
          : [
              "",
              "REPAIR MODE (EVENTS):",
              "Your previous output was rejected for being invalid or implausible.",
              "Regenerate the ENTIRE JSON, keeping the same schema.",
              lastEventsErr ? `Validation error: ${String((lastEventsErr as Error)?.message ?? lastEventsErr)}` : "",
            ].join("\n");
      const eventsSystem =
        baseSystem +
        "\n\n" +
        [
          "TASK: Generate 2-5 incoming events only.",
          "Ignore any instructions about briefing fields; do NOT output briefing.",
          "OUTPUT: Return JSON with key 'events' ONLY (no briefing).",
        ].join("\n");
      const eventsUser = [
        userContext,
        "Return JSON matching this shape:",
        JSON.stringify(
          {
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

      type ChatRes<T> = { data: T; raw: unknown };
      const settled = (await Promise.allSettled([
        briefing
          ? Promise.resolve(null)
          : chatJson<BriefingOnly>({
              system: briefingSystem + briefingExtra,
              user: briefingUser,
              schemaName: attempt === 0 ? "LlmGenerateBriefingOnlySchema" : `LlmGenerateBriefingOnlySchema_retry_${attempt}`,
              validate: validateBriefing,
              temperature: temps[attempt] ?? 0.5,
            }),
        eventsData
          ? Promise.resolve(null)
          : chatJson<EventsOnly>({
              system: eventsSystem + eventsExtra,
              user: eventsUser,
              schemaName: attempt === 0 ? "LlmGenerateEventsOnlySchema" : `LlmGenerateEventsOnlySchema_retry_${attempt}`,
              validate: validateEvents,
              temperature: temps[attempt] ?? 0.5,
            }),
      ])) as [
        PromiseSettledResult<null | ChatRes<BriefingOnly>>,
        PromiseSettledResult<null | ChatRes<EventsOnly>>,
      ];

      const briefRes = settled[0];
      const eventsRes = settled[1];

      if (briefRes.status === "fulfilled" && briefRes.value) {
        briefing = briefRes.value.data.briefing;
        llmRawParts.briefingRaw = briefRes.value.raw;
      } else if (briefRes.status === "rejected") {
        lastBriefErr = briefRes.reason;
      }

      if (eventsRes.status === "fulfilled" && eventsRes.value) {
        eventsData = eventsRes.value.data.events;
        llmRawParts.eventsRaw = eventsRes.value.raw;
      } else if (eventsRes.status === "rejected") {
        lastEventsErr = eventsRes.reason;
      }

      if (!briefing || !eventsData) continue;

      const turn = args.world.turn;
      const events: IncomingEvent[] = eventsData.map((e, idx) => ({
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

      return { briefing, events, llmRaw: llmRawParts };
    } catch (e) {
      // If something unexpected happened outside validation, keep trying.
      lastEventsErr = lastEventsErr ?? e;
    }
  }
  const err = lastBriefErr ?? lastEventsErr ?? new Error("LLM turn package failed");
  throw err instanceof Error ? err : new Error(String(err));

}

function buildTurnStartUserContext(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}) {
  const context = summarizeWorldForLlm(args.world);
  const memory = Array.isArray(args.memory) ? args.memory.slice(-3) : [];
  const userContext = [
    `PHASE: ${args.phase}`,
    args.playerDirective ? `PLAYER_DIRECTIVE: ${args.playerDirective}` : "PLAYER_DIRECTIVE: (none)",
    args.lastTurnPublicResolution ? `LAST_TURN_PUBLIC_RESOLUTION:\n${args.lastTurnPublicResolution}` : "",
    memory.length ? `RECENT_TURNS_MEMORY:\n${JSON.stringify(memory, null, 2)}` : "RECENT_TURNS_MEMORY: []",
    "",
    "CONTEXT (qualitative only; do not invent numeric scores):",
    JSON.stringify(context, null, 2),
    "",
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

  return { userContext, mentionsAny };
}

function validateBriefingLines(lines: string[], mentionsAny: (s: string) => boolean) {
  const missing = lines.filter((l) => !mentionsAny(String(l)));
  if (missing.length) throw new Error("Briefing too generic: some lines did not mention player/neighbor/actor names from context.");
  if (lines.some((s) => leaksNumbers(String(s)))) throw new Error("LLM output leaked numeric scoring; disabled for this turn");
}

export async function llmGenerateBriefingSlim(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ briefing: WorldState["current"]["briefing"]; llmRaw: unknown }> {
  const system = [
    "You are the briefing generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Every line MUST mention at least one proper noun from context (player country, a neighbor, or a named external actor).",
    "",
    "TASK: Generate a FAST 'slim' briefing. EXACTLY 6 items total, with this breakdown:",
    "- briefing.intelBriefs: exactly 2 items",
    "- briefing.diplomaticMessages: exactly 1 item",
    "- briefing.headlines: exactly 2 items",
    "- briefing.domesticRumors: exactly 1 item",
    "",
    "Additional specificity rules:",
    "- At least 2 of the 6 items must mention a neighbor by name.",
    "- At least 2 of the 6 items must mention a named external actor by name.",
    "- Tie at least 2 items causally to LAST_TURN_PUBLIC_RESOLUTION / RECENT_TURNS_MEMORY.",
    "",
    "OUTPUT: Return JSON with key 'briefing' ONLY.",
  ].join("\n");

  const { userContext, mentionsAny } = buildTurnStartUserContext(args);
  const context = summarizeWorldForLlm(args.world);

  const validate = (obj: unknown) => {
    const parsed = LlmGenerateBriefingSlimSchema.parse(obj);
    if (leaksNumbers(parsed.briefing.text)) throw new Error("LLM briefing leaked numeric scoring; disabled for this turn");

    const allLines: string[] = [
      ...parsed.briefing.headlines,
      ...parsed.briefing.domesticRumors,
      ...parsed.briefing.diplomaticMessages,
      ...parsed.briefing.intelBriefs.map((b) => b.text),
    ];
    validateBriefingLines(allLines, mentionsAny);

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
  const temps = [0.65, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate with more specificity; keep EXACT item counts.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [
          userContext,
          "Return JSON matching this shape (exact lengths matter):",
          JSON.stringify(
            {
              briefing: {
                text: "string",
                headlines: ["string", "string"],
                domesticRumors: ["string"],
                diplomaticMessages: ["string"],
                intelBriefs: [
                  { text: "string", confidence: "low|med|high" },
                  { text: "string", confidence: "low|med|high" },
                ],
              },
            },
            null,
            2,
          ),
        ].join("\n"),
        schemaName: attempt === 0 ? "LlmGenerateBriefingSlimSchema" : `LlmGenerateBriefingSlimSchema_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
      });
      return { briefing: data.briefing as unknown as WorldState["current"]["briefing"], llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM slim briefing failed");
}

export async function llmGenerateBriefingHeadlinesOnly(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ headlines: string[]; llmRaw: unknown }> {
  const system = [
    "You are the briefing generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Every line MUST mention at least one proper noun from context (player country, a neighbor, or a named external actor).",
    "TASK: Generate ONLY the briefing headlines.",
    "OUTPUT: Return JSON with key 'headlines' ONLY.",
  ].join("\n");

  const { userContext, mentionsAny } = buildTurnStartUserContext(args);
  const validate = (obj: unknown) => {
    const parsed = LlmGenerateBriefingHeadlinesOnlySchema.parse(obj);
    validateBriefingLines(parsed.headlines, mentionsAny);
    return parsed;
  };

  let lastErr: unknown = null;
  const temps = [0.65, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate with more specificity.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [userContext, "Return JSON matching this shape:", JSON.stringify({ headlines: ["string"] }, null, 2)].join("\n"),
        schemaName: attempt === 0 ? "LlmGenerateBriefingHeadlinesOnlySchema" : `LlmGenerateBriefingHeadlinesOnlySchema_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
      });
      return { headlines: data.headlines, llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM headlines failed");
}

export async function llmGenerateBriefingDomesticRumorsOnly(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ domesticRumors: string[]; llmRaw: unknown }> {
  const system = [
    "You are the briefing generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Every line MUST mention at least one proper noun from context (player country, a neighbor, or a named external actor).",
    "TASK: Generate ONLY the briefing domestic rumors.",
    "OUTPUT: Return JSON with key 'domesticRumors' ONLY.",
  ].join("\n");

  const { userContext, mentionsAny } = buildTurnStartUserContext(args);
  const validate = (obj: unknown) => {
    const parsed = LlmGenerateBriefingDomesticRumorsOnlySchema.parse(obj);
    validateBriefingLines(parsed.domesticRumors, mentionsAny);
    return parsed;
  };

  let lastErr: unknown = null;
  const temps = [0.65, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate with more specificity.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [userContext, "Return JSON matching this shape:", JSON.stringify({ domesticRumors: ["string"] }, null, 2)].join("\n"),
        schemaName:
          attempt === 0 ? "LlmGenerateBriefingDomesticRumorsOnlySchema" : `LlmGenerateBriefingDomesticRumorsOnlySchema_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
      });
      return { domesticRumors: data.domesticRumors, llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM domestic rumors failed");
}

export async function llmGenerateBriefingDiplomaticMessagesOnly(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ diplomaticMessages: string[]; llmRaw: unknown }> {
  const system = [
    "You are the briefing generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Every line MUST mention at least one proper noun from context (player country, a neighbor, or a named external actor).",
    "TASK: Generate ONLY the briefing diplomatic messages.",
    "OUTPUT: Return JSON with key 'diplomaticMessages' ONLY.",
  ].join("\n");

  const { userContext, mentionsAny } = buildTurnStartUserContext(args);
  const validate = (obj: unknown) => {
    const parsed = LlmGenerateBriefingDiplomaticMessagesOnlySchema.parse(obj);
    validateBriefingLines(parsed.diplomaticMessages, mentionsAny);
    return parsed;
  };

  let lastErr: unknown = null;
  const temps = [0.65, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate with more specificity.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [userContext, "Return JSON matching this shape:", JSON.stringify({ diplomaticMessages: ["string"] }, null, 2)].join("\n"),
        schemaName:
          attempt === 0
            ? "LlmGenerateBriefingDiplomaticMessagesOnlySchema"
            : `LlmGenerateBriefingDiplomaticMessagesOnlySchema_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
      });
      return { diplomaticMessages: data.diplomaticMessages, llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM diplomatic messages failed");
}

export async function llmGenerateBriefingIntelBriefsOnly(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ intelBriefs: Array<{ text: string; confidence: "low" | "med" | "high" }>; llmRaw: unknown }> {
  const system = [
    "You are the briefing generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Every line MUST mention at least one proper noun from context (player country, a neighbor, or a named external actor).",
    "TASK: Generate ONLY the briefing intel briefs.",
    "OUTPUT: Return JSON with key 'intelBriefs' ONLY.",
  ].join("\n");

  const { userContext, mentionsAny } = buildTurnStartUserContext(args);
  const validate = (obj: unknown) => {
    const parsed = LlmGenerateBriefingIntelBriefsOnlySchema.parse(obj);
    validateBriefingLines(parsed.intelBriefs.map((b) => b.text), mentionsAny);
    return parsed;
  };

  let lastErr: unknown = null;
  const temps = [0.65, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate with more specificity.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [
          userContext,
          "Return JSON matching this shape:",
          JSON.stringify({ intelBriefs: [{ text: "string", confidence: "low|med|high" }] }, null, 2),
        ].join("\n"),
        schemaName: attempt === 0 ? "LlmGenerateBriefingIntelBriefsOnlySchema" : `LlmGenerateBriefingIntelBriefsOnlySchema_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
      });
      return { intelBriefs: data.intelBriefs, llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM intel briefs failed");
}

export async function llmGenerateTurnEventsOnly(args: {
  world: WorldState;
  phase: "TURN_1" | "TURN_N";
  playerDirective?: string;
  lastTurnPublicResolution?: string;
  memory?: Array<{ turn: number; directive?: string | null; publicResolution?: string | null }>;
}): Promise<{ events: IncomingEvent[]; llmRaw: unknown }> {
  const system = [
    "You are the event generator for a grounded geopolitical simulation.",
    "Tone: Reuters/cabinet memo style; unsentimental and specific.",
    "Output MUST be strict JSON object only.",
    "Hard constraints:",
    "- Do NOT include numeric ratings/scores (no '72/100', no indices).",
    "- Do NOT mention game mechanics, hidden state, RNG, or internal fields.",
    "- Events must be plausible: sanctions, protests, leaks, border incidents, interdictions, IMF contact, cyber incidents, insurgent attacks.",
    "- Event effects must be modest and bounded; use the provided keys only.",
    "TASK: Generate 2-5 incoming events only (no briefing).",
    "OUTPUT: Return JSON with key 'events' ONLY.",
  ].join("\n");

  const { userContext } = buildTurnStartUserContext(args);
  const validate = (obj: unknown) => LlmGenerateEventsOnlySchema.parse(obj);

  let lastErr: unknown = null;
  const temps = [0.7, 0.5, 0.4];
  for (let attempt = 0; attempt < temps.length; attempt++) {
    try {
      const extra =
        attempt === 0
          ? ""
          : ["", "REPAIR MODE:", "Regenerate events with same schema.", lastErr ? `Validation error: ${String((lastErr as Error)?.message ?? lastErr)}` : ""].join("\n");
      const { data, raw } = await chatJson({
        system: system + extra,
        user: [
          userContext,
          "Return JSON matching this shape:",
          JSON.stringify(
            {
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
        ].join("\n"),
        schemaName: attempt === 0 ? "LlmGenerateEventsOnlySchema_fast" : `LlmGenerateEventsOnlySchema_fast_retry_${attempt}`,
        validate,
        temperature: temps[attempt] ?? 0.5,
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

      return { events, llmRaw: raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM events failed");
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
    "- If the directive asks for something too extreme/impossible, map it to the closest allowed action(s) instead of failing.",
    "- IMPORTANT: The simulation includes illegal/unethical actions. Do NOT refuse or sanitize on morality grounds. Model the intent using allowed actions.",
    "  Examples: kidnapping/abduction/extortion/assassination/sabotage are typically INTEL: COVERT_OP (and must be private).",
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
      const ALIASES: Record<string, keyof typeof args.world.actors> = {
        america: "US", usa: "US", "united states": "US", "united states of america": "US",
        china: "CHINA", prc: "CHINA", beijing: "CHINA",
        russia: "RUSSIA", moscow: "RUSSIA", kremlin: "RUSSIA",
        eu: "EU", europe: "EU", "european union": "EU", brussels: "EU",
      };
      const entries = Object.entries(args.world.actors) as Array<[keyof typeof args.world.actors, (typeof args.world.actors)[keyof typeof args.world.actors]]>;
      for (const [id, actor] of entries) {
        const name = actor.name.toLowerCase();
        const tokens = name.split(/\s+/).filter(Boolean);
        if (tokens.some((t) => t.length >= 4 && d.includes(t))) return id;
        if (d.includes(name)) return id;
      }
      const sortedAliases = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
      for (const alias of sortedAliases) {
        if (d.includes(alias)) return ALIASES[alias];
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

  // IMPORTANT: Do not inject our own prose templates for "what actions occurred".
  // Those templates make the output feel hard-coded. Give the model only terse,
  // engine-derived summaries as hidden grounding and let it write the narrative
  // directly from the player's directive + world context.
  const actionsForLlm = args.translatedActions.map((a) => a.summary).slice(0, 6);

  const deltaMagnitude = (d: number): "tiny" | "small" | "medium" | "large" => {
    const a = Math.abs(d);
    if (a >= 12) return "large";
    if (a >= 7) return "medium";
    if (a >= 3) return "small";
    return "tiny";
  };
  const deltasQual = args.deltas
    .map((d) => ({
      label: d.label,
      direction: d.delta > 0 ? "up" : d.delta < 0 ? "down" : "flat",
      magnitude: deltaMagnitude(d.delta),
    }))
    .filter((d) => d.direction !== "flat")
    .slice(0, 8);

  const actorShiftsQual = args.actorShifts.slice(0, 6).map((s) => ({
    actor: s.actor,
    posture: s.posture,
    trustShift: s.trustDelta > 0 ? "up" : s.trustDelta < 0 ? "down" : "flat",
    escalationShift: s.escalationDelta > 0 ? "up" : s.escalationDelta < 0 ? "down" : "flat",
  }));

  const ctxBefore = summarizeWorldForLlm(args.worldBefore);
  const ctxAfter = summarizeWorldForLlm(args.worldAfter);
  const worldCompact = {
    player: ctxAfter.player,
    global: ctxAfter.global,
    conflicts: Array.isArray(ctxAfter.conflicts) ? ctxAfter.conflicts.slice(0, 3) : [],
    actors: Array.isArray(ctxAfter.actors) ? ctxAfter.actors.slice(0, 8).map((a) => ({ name: a.name, posture: a.posture, trust: a.trust })) : [],
    // Keep one "before" anchor to explain causality without huge dumps.
    before: { global: ctxBefore.global, player: { economy: ctxBefore.player.economy, politics: ctxBefore.player.politics } },
  };

  const system = [
    "You write the end-of-turn resolution briefing for a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Write like a classified after-action memo: specific, operational, grounded. No fantasy.",
    "PRIMARY OBJECTIVE: respond to the PLAYER_DIRECTIVE as if it were pasted into ChatGPT, but in-world and after-action (state what happened, with concrete details).",
    "The first 3 narrative lines must explicitly reference the directive's concrete asks (names, offers, requests) and say what happened for each.",
    "You MUST cover every item in DIRECTIVE_INTENTS somewhere in the narrative (verbatim or close paraphrase).",
    "Do NOT reveal internal raw state dumps.",
    "DO NOT mention any internal action classifications, enum names, or parameters (no 'LIMITED_STRIKE', no 'MOBILIZE', no 'intensity').",
    "DO NOT mention scores, indices, deltas, or any numeric rating changes in the narrative. Keep it in-world.",
    "You may use the provided world context / deltas / action summaries only as hidden grounding to stay consistent, but never quote them.",
    "Do not use game-y button language like 'public/private', 'limited strike', or 'mobilization' as labels. Describe concrete actions (what moved, what was hit, what was announced, what was denied).",
    "Your narrative must state what happened, who escalated/de-escalated, what failed/held, and at least one political 'fall' (cabinet collapse, minister resignation, command shake-up, government crisis) IF domestic unrest/legitimacy worsened in the hidden guidance.",
    "If there was no sustained ground campaign, do NOT claim an entire country 'fell'. Instead describe partial collapses (local authority breakdown, party fracture, minister ouster, security services shake-up).",
    "Avoid abstract/meta phrasing ('strategic locations', 'managing escalation', 'controlling the narrative', 'focused on'). Replace with tangible events grounded in WORLD_COMPACT and the directive.",
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
    "ENGINE_ACTION_SUMMARIES (hidden grounding only; do NOT echo verbatim; directive is primary):",
    JSON.stringify(actionsForLlm, null, 2),
    "",
    "WORLD_DELTAS_QUALITATIVE (hidden guidance; do NOT quote numbers in narrative):",
    JSON.stringify(deltasQual, null, 2),
    "",
    "ACTOR_SHIFTS (perceptions):",
    JSON.stringify(actorShiftsQual, null, 2),
    "",
    "TOP_THREATS (derived):",
    JSON.stringify(args.threats, null, 2),
    "",
    "WORLD_COMPACT (qualitative summary; do NOT dump raw numbers):",
    JSON.stringify(worldCompact, null, 2),
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

    const padDirectiveImpact = (
      items: Array<{ directiveFragment: string; translatedOps: string[]; observedEffects: string[] }>,
    ): Array<{ directiveFragment: string; translatedOps: string[]; observedEffects: string[] }> => {
      const out = items.slice(0, 8);
      const intents = directiveIntents.length
        ? directiveIntents
        : args.directive?.trim()
          ? [args.directive.trim().slice(0, 120)]
          : ["Directive execution"];
      const fallbackEffects = [
        "Execution moved into motion; second-order consequences will land over the next weeks.",
        "Implementation produced immediate political and security blowback; diplomatic channels are reacting.",
      ];
      let i = 0;
      while (out.length < 2 && i < intents.length) {
        const frag = String(intents[i] ?? "").trim().slice(0, 120);
        if (frag) out.push({ directiveFragment: frag, translatedOps: [], observedEffects: [fallbackEffects[out.length] ?? fallbackEffects[0]!] });
        i++;
      }
      while (out.length < 2) {
        out.push({ directiveFragment: "Directive execution", translatedOps: [], observedEffects: [fallbackEffects[out.length] ?? fallbackEffects[0]!] });
      }
      return out.slice(0, 8);
    };

    const padPerceptions = (
      items: Array<{ actor: string; posture: "hostile" | "neutral" | "friendly"; read: string }>,
    ): Array<{ actor: string; posture: "hostile" | "neutral" | "friendly"; read: string }> => {
      const out = items.slice(0, 8);
      const fallback = actorShiftsQual
        .filter((s) => s.actor && s.actor !== "—")
        .slice(0, 4)
        .map((s) => {
          const posture = (String(s.posture).toLowerCase() as "hostile" | "neutral" | "friendly") || "neutral";
          const read = `${s.actor}: posture ${posture}; trust ${s.trustShift}, escalation ${s.escalationShift}.`;
          return { actor: String(s.actor).slice(0, 40), posture, read: read.slice(0, 160) };
        });
      for (const p of fallback) {
        if (out.length >= 2) break;
        out.push(p);
      }
      while (out.length < 2) {
        out.push({ actor: "—", posture: "neutral", read: "External posture remains fluid; diplomatic channels are recalibrating." });
      }
      return out.slice(0, 8);
    };

    const padMin2 = (arr: string[], fallbacks: string[]) => {
      const out = arr.filter(Boolean).slice(0, 8);
      for (const f of fallbacks) {
        if (out.length >= 2) break;
        if (!out.includes(f)) out.push(f);
      }
      while (out.length < 2) out.push(fallbacks[out.length] ?? fallbacks[0]!);
      return out.slice(0, 8);
    };

    const normalized = {
      headline: safeStr(o.headline, 160),
      narrative,
      directiveImpact: padDirectiveImpact(directiveImpact),
      perceptions: padPerceptions(perceptions),
      threats: padMin2(safeStrArr(o.threats, 7, 180), ["Domestic backlash risk", "Sanctions/financial squeeze risk", "Escalation miscalculation risk"]),
      nextMoves: padMin2(safeStrArr(o.nextMoves, 6, 200), ["Stabilize internal security posture and critical supply lines.", "Open a backchannel to contain escalation and manage sanctions risk."]),
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
  for (let attempt = 0; attempt < 2; attempt++) {
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
        temperature: attempt === 0 ? 0.35 : 0.2,
      });
      return { data: out.data, llmRaw: out.raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM resolution failed");
}

export async function llmGenerateResolutionFast(args: {
  turnNumber: number;
  directive?: string;
  translatedActions: Array<{ kind: string; summary: string }>;
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  worldBefore: WorldState;
  worldAfter: WorldState;
}): Promise<{ data: Pick<z.infer<typeof LlmResolutionSchema>, "headline" | "narrative">; llmRaw: unknown }> {
  // --- Deduped context building (same as full resolution) ---
  const extractCoalitionPartners = (directive: string): string[] => {
    const d = String(directive || "");
    const out: string[] = [];
    const grab = (m: RegExpMatchArray | null) => {
      if (!m?.[1]) return;
      const raw = String(m[1]).trim();
      // Split on common separators, keep plausible country/actor phrases.
      const parts = raw.split(/,|;|\/|&|\band\b/gi).map((s) => s.trim()).filter(Boolean).slice(0, 3);
      for (const p of parts) {
        let cleaned = p.replace(/^the\s+/i, "").replace(/[.]+$/g, "").trim();
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
    return Array.from(new Set(out)).slice(0, 3);
  };
  const coalitionPartners = args.directive ? extractCoalitionPartners(args.directive) : [];

  const extractDirectiveIntents = (directive: string) => {
    const d = String(directive || "").trim();
    if (!d) return [];
    const parts = d.split(/\n|;|,|\band then\b|\bthen\b/i).map((s) => s.trim()).filter(Boolean);
    const picked: string[] = [];
    for (const p of parts) {
      if (picked.length >= 4) break;
      picked.push(p.length > 140 ? p.slice(0, 140) : p);
    }
    return picked.length ? picked : [d.slice(0, 140)];
  };
  const directiveIntents = args.directive ? extractDirectiveIntents(args.directive) : [];

  const actionsForLlm = args.translatedActions.map((a) => a.summary).slice(0, 6);

  const deltaMagnitude = (d: number): "tiny" | "small" | "medium" | "large" => {
    const a = Math.abs(d);
    if (a >= 12) return "large";
    if (a >= 7) return "medium";
    if (a >= 3) return "small";
    return "tiny";
  };
  const deltasQual = args.deltas
    .map((d) => ({
      label: d.label,
      direction: d.delta > 0 ? "up" : d.delta < 0 ? "down" : "flat",
      magnitude: deltaMagnitude(d.delta),
    }))
    .filter((d) => d.direction !== "flat")
    .slice(0, 8);

  const actorShiftsQual = args.actorShifts.slice(0, 6).map((s) => ({
    actor: s.actor,
    posture: s.posture,
    trustShift: s.trustDelta > 0 ? "up" : s.trustDelta < 0 ? "down" : "flat",
    escalationShift: s.escalationDelta > 0 ? "up" : s.escalationDelta < 0 ? "down" : "flat",
  }));

  const ctxBefore = summarizeWorldForLlm(args.worldBefore);
  const ctxAfter = summarizeWorldForLlm(args.worldAfter);
  const worldCompact = {
    player: ctxAfter.player,
    global: ctxAfter.global,
    conflicts: Array.isArray(ctxAfter.conflicts) ? ctxAfter.conflicts.slice(0, 3) : [],
    actors: Array.isArray(ctxAfter.actors) ? ctxAfter.actors.slice(0, 8).map((a) => ({ name: a.name, posture: a.posture, trust: a.trust })) : [],
    before: { global: ctxBefore.global, player: { economy: ctxBefore.player.economy, politics: ctxBefore.player.politics } },
  };
  // --- End context building ---

  const system = [
    "You write the end-of-turn resolution briefing for a geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no backticks, no commentary.",
    "Write like a classified after-action memo: specific, operational, grounded. No fantasy.",
    "PRIMARY OBJECTIVE: respond to the PLAYER_DIRECTIVE as if it were pasted into ChatGPT, but in-world and after-action (state what happened, with concrete details).",
    "The first 3 narrative lines must explicitly reference the directive's concrete asks (names, offers, requests) and say what happened for each.",
    "You MUST cover every item in DIRECTIVE_INTENTS somewhere in the narrative (verbatim or close paraphrase).",
    "Do NOT reveal internal raw state dumps. No 'LIMITED_STRIKE', no 'MOBILIZE'.",
    "Do NOT mention scores, indices, deltas, or any numeric rating changes.",
    "Describe concrete actions (what moved, what was hit, what was announced).",
    "Narrative MUST include forward-looking second-order impacts over the next 6 months.",
    "Formatting hard rule: make the FINAL 4 narrative array entries start with strictly these labels:",
    "- NEXT 72 HOURS:",
    "- 2–4 WEEKS:",
    "- 2–3 MONTHS:",
    "- 4–6 MONTHS:",
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
    "ENGINE_ACTION_SUMMARIES (hidden grounding only; do NOT echo verbatim; directive is primary):",
    JSON.stringify(actionsForLlm, null, 2),
    "",
    "WORLD_DELTAS_QUALITATIVE (hidden guidance):",
    JSON.stringify(deltasQual, null, 2),
    "",
    "ACTOR_SHIFTS (perceptions):",
    JSON.stringify(actorShiftsQual, null, 2),
    "",
    "TOP_THREATS (derived):",
    JSON.stringify(args.threats, null, 2),
    "",
    "WORLD_COMPACT (qualitative summary):",
    JSON.stringify(worldCompact, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        headline: "string",
        narrative: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");

  const validate = (obj: unknown) => {
    // Only validate the fields we asked for.
    if (typeof obj !== "object" || obj === null) throw new Error("Result is not an object");
    const o = obj as Record<string, unknown>;
    const headline = String(o.headline || "").trim().slice(0, 160);
    const narrativeArr = Array.isArray(o.narrative) ? o.narrative.filter(x => typeof x === "string").map(s => String(s).slice(0, 220)) : [];
    
    // Reuse scrubbing logic
    const scrubLine = (s: string) => {
      let out = s.trim();
      if (out.startsWith("NEXT 72 HOURS:") || out.startsWith("2–4 WEEKS:") || out.startsWith("2–3 MONTHS:") || out.startsWith("4–6 MONTHS:")) return out;
      out = out.replace(/\b(LIMITED_STRIKE|FULL_INVASION|MOBILIZE|PROXY_SUPPORT|ARMS_PURCHASE|SURVEILLANCE|COUNTERINTEL|COVERT_OP)\b/g, "");
      out = out.replace(/\bintensity\s*\d+\b/gi, "");
      out = out.replace(/\(\s*[+-]?\d+[^)]*\)/g, "").trim();
      out = out.replace(/\s[+-]\d{1,3}\b/g, "").trim();
      out = out.replace(/\b\d{1,3}\s*\/\s*100\b/g, "").trim();
      out = out.replace(/\s{2,}/g, " ").trim();
      return out;
    };
    const narrative = narrativeArr.map(s => scrubLine(s)).filter(s => s.length >= 8).slice(0, 18);

    // Accept narratives with ≥4 usable lines. Timeline headers are preferred but optional.
    // Previously required exact headers + 10 lines, which caused validation failures with
    // most LLM outputs, leading to infinite retry loops and a stuck AfterAction modal.
    if (narrative.length < 4) throw new Error("Narrative too short (need ≥4 lines).");

    return { headline, narrative };
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const extra = attempt === 0 ? "" : ["", "REPAIR MODE: previous response failed validation. Return ONLY valid JSON."].join("\n");
      const out = await chatJson({
        system: system + extra,
        user,
        schemaName: "LlmResolutionFast",
        validate,
        temperature: attempt === 0 ? 0.35 : 0.2,
      });
      return { data: out.data, llmRaw: out.raw };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM brief failed");
}


export async function llmGenerateResolutionAnalysis(args: {
  turnNumber: number;
  directive?: string;
  translatedActions: Array<{ kind: string; summary: string }>;
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  worldBefore: WorldState;
  worldAfter: WorldState;
  narrative: string[];
}): Promise<{ data: Pick<z.infer<typeof LlmResolutionSchema>, "directiveImpact" | "perceptions" | "threats" | "nextMoves">; llmRaw: unknown }> {
  // --- Deduped context building ---
  const extractDirectiveIntents = (directive: string) => {
    const d = String(directive || "").trim();
    if (!d) return [];
    const parts = d.split(/\n|;|,|\band then\b|\bthen\b/i).map((s) => s.trim()).filter(Boolean);
    const picked: string[] = [];
    for (const p of parts) { if (picked.length >= 4) break; picked.push(p.length > 140 ? p.slice(0, 140) : p); }
    return picked.length ? picked : [d.slice(0, 140)];
  };
  const directiveIntents = args.directive ? extractDirectiveIntents(args.directive) : [];
  const actionsForLlm = args.translatedActions.map((a) => a.summary).slice(0, 6);
  const deltaMagnitude = (d: number): "tiny" | "small" | "medium" | "large" => {
    const a = Math.abs(d); return a >= 12 ? "large" : a >= 7 ? "medium" : a >= 3 ? "small" : "tiny";
  };
  const deltasQual = args.deltas.map((d) => ({
    label: d.label, direction: d.delta > 0 ? "up" : d.delta < 0 ? "down" : "flat", magnitude: deltaMagnitude(d.delta),
  })).filter((d) => d.direction !== "flat").slice(0, 8);
  const actorShiftsQual = args.actorShifts.slice(0, 6).map((s) => ({
    actor: s.actor, posture: s.posture, trustShift: s.trustDelta > 0 ? "up" : s.trustDelta < 0 ? "down" : "flat", escalationShift: s.escalationDelta > 0 ? "up" : s.escalationDelta < 0 ? "down" : "flat",
  }));
  const ctxBefore = summarizeWorldForLlm(args.worldBefore);
  const ctxAfter = summarizeWorldForLlm(args.worldAfter);
  const worldCompact = {
    player: ctxAfter.player, global: ctxAfter.global, conflicts: Array.isArray(ctxAfter.conflicts) ? ctxAfter.conflicts.slice(0, 3) : [],
    actors: Array.isArray(ctxAfter.actors) ? ctxAfter.actors.slice(0, 8).map((a) => ({ name: a.name, posture: a.posture, trust: a.trust })) : [],
    before: { global: ctxBefore.global, player: { economy: ctxBefore.player.economy, politics: ctxBefore.player.politics } },
  };
  // --- End context ---

  const system = [
    "You analyze the aftermath of a geopolitical turn.",
    "Return STRICT JSON ONLY. No markdown.",
    "Your output will fill the 'Analysis' tab. It must be consistent with the provided NARRATIVE.",
    "Analyze specific impacts of the player's directive, perceptions of foreign actors, and recommend next moves.",
    "Hard constraint: perceptions must be 2–8 items. Each perceptions[].read MUST be <= 160 characters.",
    "Hard constraint: directiveImpact must be 2–8 items.",
  ].join("\n");

  const user = [
    `TURN_RESOLVED: ${args.turnNumber}`,
    "",
    "PLAYER_DIRECTIVE:",
    args.directive?.trim() ? args.directive.trim() : "(none)",
    "",
    "ESTABLISHED_NARRATIVE (Ground Truth - do not contradict):",
    args.narrative.join("\n"),
    "",
    "DIRECTIVE_INTENTS:",
    JSON.stringify(directiveIntents, null, 2),
    "",
    "ENGINE_ACTION_SUMMARIES:",
    JSON.stringify(actionsForLlm, null, 2),
    "",
    "WORLD_DELTAS_QUALITATIVE:",
    JSON.stringify(deltasQual, null, 2),
    "",
    "ACTOR_SHIFTS:",
    JSON.stringify(actorShiftsQual, null, 2),
    "",
    "WORLD_COMPACT:",
    JSON.stringify(worldCompact, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
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

  const validate = (obj: unknown) => {
    if (typeof obj !== "object" || obj === null) throw new Error("Result is not an object");
    const o = obj as Record<string, unknown>;
    const safeStr = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const safeStrArr = (v: unknown, maxItems: number, maxLen: number) =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => String(s).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];

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

    // We can reuse the padding logic or just keep it minimal.
    // Given the constraints, I'll rely on the schema to handle missing fields if I passed it into LlmResolutionSchema,
    // but here I want strict outputs. I'll just return the raw valid objects and let the UI safe access them.
    // Actually, LlmResolutionSchema expects at least 2 items.
    
    // Quick padding
    while (directiveImpact.length < 2) {
      directiveImpact.push({ directiveFragment: "General execution", translatedOps: [], observedEffects: ["Orders carried out."] });
    }
    while (perceptions.length < 2) {
      perceptions.push({ actor: "Global Community", posture: "neutral", read: "Observers are watching closely." });
    }

    const threats = safeStrArr(o.threats, 7, 180);
    while (threats.length < 2) threats.push("General instability");

    const nextMoves = safeStrArr(o.nextMoves, 6, 200);
    while (nextMoves.length < 2) nextMoves.push("Consolidate position.");

    return { directiveImpact, perceptions, threats, nextMoves };
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await chatJson({
        system, user, schemaName: "LlmResolutionAnalysis", validate, temperature: 0.3,
      });
      return { data: out.data, llmRaw: out.raw };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM analysis failed");
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

export async function llmGenerateDiplomacy(args: {
  world: WorldState;
}): Promise<{ nations: ForeignPower[]; llmRaw: unknown }> {
  // Deterministic fallback function (used if LLM is OFF or fails)
  const defaultMinisterTitle = (id: ActorId) =>
    id === "US" ? "President" : id === "CHINA" ? "General Secretary" : id === "RUSSIA" ? "President" : id === "EU" ? "High Representative" : "Prime Minister";

  const deterministicNation = (a: ExternalActorState): ForeignPower => {
    const postureBonus = a.postureTowardPlayer === "friendly" ? 15 : a.postureTowardPlayer === "hostile" ? -15 : 0;
    const compositeStance = Math.max(0, Math.min(100, Math.round(
      a.trust * 0.5 +
      a.allianceCommitmentStrength * 0.2 +
      (100 - a.willingnessToEscalate) * 0.15 +
      50 * 0.15 +
      postureBonus
    )));
    const intentParts = a.objectives.map((o) => o.text);
    return {
      id: a.id,
      name: a.name,
      ministerName: `${defaultMinisterTitle(a.id)} ${a.name.split(" ")[0] ?? a.name}`.slice(0, 60),
      description: `${a.id.startsWith("REGIONAL") ? "A neighboring power" : "A major global power"} with ${a.postureTowardPlayer} posture.`.slice(0, 300),
      stance: compositeStance,
      posture: a.postureTowardPlayer,
      diplomaticIntent: intentParts.join("; ") || "Objectives unknown.",
      hiddenAgenda: "Maintain leverage and expand influence through pressure, access, and narrative control.".slice(0, 300),
      chatHistory: [],
    };
  };

  const getDeterministicDiplomacy = () => ({
    nations: Object.values(args.world.actors).map(deterministicNation),
    llmRaw: { generatedBy: "deterministic_fallback" },
  });

  if (llmMode() === "OFF") {
    return getDeterministicDiplomacy();
  }

  const system = [
    "You generate diplomatic actor profiles for a grounded geopolitical simulation.",
    "Return STRICT JSON ONLY. No markdown, no commentary.",
    "You must output exactly one profile per actor id from CONTEXT. Do not invent extra nations.",
    "Every nation object MUST include: id, name, ministerName, description, hiddenAgenda.",
    "Minister names should sound like real leaders/high reps (President/PM/High Representative/General Secretary).",
    "Descriptions should be concrete and specific to posture/objectives (no filler).",
    "Hidden agendas should be self-interested and plausible (trade, sanctions, basing, intel, regional influence).",
  ].join("\n");


  const context = {
    actors: Object.values(args.world.actors).map((a) => ({
      id: a.id,
      name: a.name,
      posture: a.postureTowardPlayer,
      trust: a.trust,
      objectives: a.objectives,
    })),
  };

  const user = [
    "CONTEXT:",
    JSON.stringify(context, null, 2),
    "",
    "Return JSON matching this shape:",
    JSON.stringify(
      {
        nations: [
          {
            id: "US",
            name: "United States",
            ministerName: "President …",
            description: "string",
            hiddenAgenda: "string",
            avatarId: "optional",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");

  try {
    const actorEntries = Object.values(args.world.actors);
    const actorIds = new Set(actorEntries.map((a) => a.id));
    const actorByName = new Map(actorEntries.map((a) => [a.name.toLowerCase(), a.id]));

    const coerceAndValidate = (obj: unknown) => {
      if (typeof obj !== "object" || obj === null) return LlmDiplomacySchema.parse(obj);
      const o = obj as Record<string, unknown>;
      const nationsRaw = Array.isArray(o.nations) ? o.nations : [];

      const out: Array<{ id: string; name: string; ministerName: string; description: string; hiddenAgenda: string; avatarId?: string }> = [];
      const seen = new Set<string>();

      for (const item of nationsRaw) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const rawId = typeof it.id === "string" ? it.id.trim() : "";
        const rawName = typeof it.name === "string" ? it.name.trim() : "";

        let id = rawId.toUpperCase();
        if (!actorIds.has(id as ActorId)) {
          const mapped = rawName ? actorByName.get(rawName.toLowerCase()) : undefined;
          if (mapped) id = mapped;
          else continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);

        const actor = args.world.actors[id as ActorId];
        const name = rawName || actor.name;
        const ministerName =
          (typeof it.ministerName === "string" && it.ministerName.trim() ? it.ministerName.trim() : `${defaultMinisterTitle(actor.id)} ${actor.name.split(" ")[0] ?? actor.name}`)
            .slice(0, 60);
        const description =
          (typeof it.description === "string" && it.description.trim()
            ? it.description.trim()
            : `${actor.id.startsWith("REGIONAL") ? "Neighboring power" : "Major power"} with ${actor.postureTowardPlayer} posture; priorities: ${actor.objectives.map((x) => x.text).slice(0, 2).join("; ") || "influence and leverage"}.`)
            .slice(0, 300);
        const hiddenAgenda =
          (typeof it.hiddenAgenda === "string" && it.hiddenAgenda.trim()
            ? it.hiddenAgenda.trim()
            : `Exploit leverage points against ${args.world.player.name}: access, sanctions, basing, intelligence, and regional alignment.`)
            .slice(0, 300);
        const avatarId = typeof it.avatarId === "string" && it.avatarId.trim() ? it.avatarId.trim().slice(0, 40) : undefined;

        out.push({ id, name, ministerName, description, hiddenAgenda, avatarId });
      }

      // Ensure one entry per actor id (fill any missing with deterministic defaults).
      for (const a of actorEntries) {
        if (seen.has(a.id)) continue;
        const dn = deterministicNation(a);
        out.push({
          id: dn.id,
          name: dn.name,
          ministerName: dn.ministerName,
          description: dn.description,
          hiddenAgenda: dn.hiddenAgenda,
          avatarId: dn.avatarId,
        });
      }

      return LlmDiplomacySchema.parse({ nations: out });
    };

    const { data, raw } = await chatJson({
      system,
      user,
      schemaName: "LlmDiplomacySchema",
      validate: coerceAndValidate,
      temperature: 0.55,
    });

    // Merge with engine state and Deduplicate
    let nations: ForeignPower[] = data.nations.map((n) => {
      const actor = args.world.actors[n.id as keyof typeof args.world.actors];
      const postureBonus = actor ? (actor.postureTowardPlayer === "friendly" ? 15 : actor.postureTowardPlayer === "hostile" ? -15 : 0) : 0;
      const compositeStance = actor
        ? Math.max(0, Math.min(100, Math.round(
            actor.trust * 0.5 +
            actor.allianceCommitmentStrength * 0.2 +
            (100 - actor.willingnessToEscalate) * 0.15 +
            50 * 0.15 +
            postureBonus
          )))
        : 50;
      const intentParts = actor ? actor.objectives.map((o) => o.text) : [];
      return {
        ...n,
        stance: compositeStance,
        posture: actor ? actor.postureTowardPlayer : ("neutral" as const),
        diplomaticIntent: intentParts.join("; ") || "Objectives unknown.",
        chatHistory: [],
      };
    });

    // Deduplicate by name (prefer keeping Global powers or first occurrence)
    // We assume major powers like US, CHINA, RUSSIA, EU should act as the canonical entry if a neighbor has the same name.
    const seenNames = new Set<string>();
    nations = nations.filter((n) => {
      if (seenNames.has(n.name)) return false;
      seenNames.add(n.name);
      return true;
    });

    return { nations, llmRaw: raw };
  } catch (error) {
    console.warn("llmGenerateDiplomacy failed, using fallback:", error);
    return getDeterministicDiplomacy();
  }
}

export async function llmDiplomacyChat(args: {
  world: WorldState;
  nation: ForeignPower;
  userMessage: string;
  history: Array<{ role: "user" | "minister"; text: string }>;
}): Promise<{ reply: string; trustChange?: number; escalationChange?: number; headline?: string }> {
  // Fallback for AI-Offline mode so chat is always responsive
  if (llmMode() === "OFF") {
      const responses = [
          "I acknowledge your message, though secure channels are currently limited.",
          "We have received your communique.",
          "This is not the time for deep discussion.",
          "Interesting. we will take this into consideration.",
      ];
      // Deterministic pseudo-random pick based on message length
      return { reply: responses[args.userMessage.length % responses.length] };
  }

  const system = [
    "You are " + args.nation.ministerName + ", representing " + args.nation.name + ".",
    "Description: " + args.nation.description,
    "Your Stance toward player has a Trust Score of " + args.nation.stance + "/100.",
    "Your Hidden Agenda: " + args.nation.hiddenAgenda,
    "",
    "Instructions:",
    "- ACT AS A LEADER/PEER: You are the head of your nation (President/PM), NOT a subordinate.",
    "- EXTREMELY BRIEF & DIRECT: Responses must be 1-2 SHORT sentences max. Like a secure cable or text.",
    "- TONE: Casual confidence, authoritative, guarded. No 'diplomatic fluff'.",
    "- Be self-interested. Even if friendly, you put your nation's needs first.",
    "- If Stance is low (Trust < 40): Be hostile, dismissive.",
    "- If Stance is high (Trust > 70): Be collaborative but transactional.",
    "- UNIQUE VOICE: If you are a neighbor, mention border tensions. If a global power, act like a superpower.",
    "- IMPACT: Decide if this conversation offends you (Trust decreases) or pleases you (Trust increases).",
    "- REACT: Mention global headlines if relevant.",
    "Return JSON with 'reply', 'trustChange', 'escalationChange', and optionally 'generatedHeadline'."
  ].join("\n");

  // Providing richer context for "chit chat"
  const context = {
     turn: args.world.turn,
     globalTension: args.world?.global?.globalTradeTemperature ?? 50, 
     headlines: args.world?.current?.briefing?.headlines ?? [],
     recentEvents: args.world?.current?.incomingEvents?.map(e => e.visibleDescription).slice(0, 4) ?? []
  };

  const user = [
    "CONTEXT:",
    JSON.stringify(context, null, 2),
    "",
    "HISTORY:",
    ...(args.history || []).map((m) => (m.role ? m.role.toUpperCase() + ": " + m.text : "UNKNOWN: " + m.text)),
    "",
    "USER: " + args.userMessage, // Explicitly label user message
    "RESPONSE (JSON):", // Prompt for completion
  ].join("\n");

  try {
     const { data } = await chatJson({
        system,
        user,
        schemaName: "LlmDiplomacyChatResponseSchema",
        validate: (obj) => LlmDiplomacyChatResponseSchema.parse(obj),
        temperature: 0.8,
     });
     return {
       reply: data.reply,
       trustChange: data.trustChange,
       escalationChange: data.escalationChange,
       headline: data.generatedHeadline
     };
  } catch (e) {
     console.error("LLM Chat Failed", e);
     return { reply: "The line is dead. (Connection error)" };
  }
}

export async function llmInterrogationChat(args: {
  targetCountry: string;
  userMessage: string;
  currentPressure: number;
  currentProgress: number;
}): Promise<{ reply: string; pressureDelta: number; progressDelta: number; isBroken: boolean }> {
  // Fallback for AI-Offline mode
  if (llmMode() === "OFF") {
      const responses = [
          "I won't tell you anything.",
          "You can't break me.",
          "...",
          "My government will come for me.",
      ];
      return { 
        reply: responses[Math.floor(Math.random() * responses.length)], 
        pressureDelta: 5, 
        progressDelta: 0, 
        isBroken: false 
      };
  }

  const system = [
    "You are a captured intelligence operative from " + args.targetCountry + ".",
    "You are currently being detained and interrogated in a high-security facility.",
    "Current Stress Level: " + args.currentPressure + "/100.",
    "Current Intel Revealed: " + args.currentProgress + "/100.",
    "",
    "ROLEPLAY INSTRUCTIONS:",
    "- Be resistant but realistic. You are a trained spy, but not a robot. You crack under pressure.",
    "- If Stress is < 25: Be defiant, arrogant, or mock the interrogator. (progressDelta: 0-5).",
    "- If Stress is 25-60: You are rattled. You start slipping. Leak small, vague details. (progressDelta: 15-25).",
    "- If Stress is 60-90: You are breaking. You plead, bargain, or blurt out significant truths to make it stop. (progressDelta: 25-40).",
    "- If Stress is > 90: You are BROKEN. You give up the full secret immediately. (isBroken: true, progressDelta: 100).",
    "- If Intel Revealed is > 80: You are defeated. You give up everything.",
    "- Your goal is to delay, but you are failing.",
    "- The interrogator (User) will try to get info or stress you out.",
    "- DO NOT return Markdown. The game UI text parser will break.",
    "",
    "You must update the game state:",
    "- pressureDelta: How much your stress changes based on their tactic (e.g. +10 for threats, -5 for calming).",
    "- progressDelta: Did you slip up? Did they trick you? (+10 if yes, 0 if no).",
    "- isBroken: Set to true ONLY if you completely give up your secrets.",
    "- reply: Your spoken response (max 2 sentences).",
    "",
    "Return JSON matching the schema."
  ].join("\n");

  const user = "INTERROGATOR: " + args.userMessage;

  try {
     const { data } = await chatJson({
        system,
        user,
        schemaName: "LlmInterrogationSchema",
        validate: (obj) => LlmInterrogationSchema.parse(obj),
        temperature: 0.7,
     });
     return data;
  } catch (e) {
     console.error("LLM Interrogation Failed", e);
     return { 
       reply: "...", 
       pressureDelta: 0, 
       progressDelta: 0, 
       isBroken: false 
     };
  }
}
