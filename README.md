# The Unscripted World Order (MVP)

An LLM-enabled, turn-based geopolitical simulation with a strict separation between **true state** and **player-visible state**. The runtime intentionally models incomplete information (confidence, fog, and biased signals) while the engine maintains a canonical world. The LLM layer, using **Mistral AI,** is used for narrative synthesis and directive parsing, and is what makes this game possible.

![gif1](https://github.com/user-attachments/assets/9f20dbb2-8328-43d9-bf84-e3a168704d8b)


![gif2](https://github.com/user-attachments/assets/5c1c12eb-da31-4fab-a374-f0d2e2a073b5)


![gif3](https://github.com/user-attachments/assets/146597e2-0764-4355-bdfd-970ac4969a34)


![gif4](https://github.com/user-attachments/assets/3a9811db-69da-4484-b470-b16ebe8d3aea)


## Local dev (Node 20+)

```bash
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

Reset state:
- UI: **Reset Simulation** on `/`
- API: `POST /api/game/reset`

## System architecture (engine → persistence → UI)

### 1) Simulation engine (`engine/`)

**Pure TypeScript. The engine owns canonical state and produces **player-facing snapshots** with noise.

- **True state**: `WorldState`
- **Player view**: `GameSnapshot` → `PlayerViewState` (confidence, partial visibility)
- Turn pipeline:
  - briefing → events → actions → resolution → delayed consequences → drift → failure detection

Key entrypoints:
- `engine/createNewGameWorld(seed)`
- `engine/submitTurnAndAdvance(gameId, world, actions)`

### 2) Persistence (`db/`, SQLite via Prisma)

The database stores **complete, immutable per-turn state**, plus the latest player snapshot for fast UI hydration.

- Schema: `db/prisma/schema.prisma`
- Tables:
  - `Game`: latest `worldState` + `lastPlayerSnapshot`
  - `TurnLog`: full **before/after world state**, actions, consequences, artifacts

### 3) UI (Next.js App Router)

UI strictly renders **player snapshots** and never reads true state directly.

Routes:
- `/` start
- `/country` profile
- `/game` control room
- `/resolution` after-action memo
- `/failure` failure state

## Core content surfaces

- **Incoming events**: `engine/events.ts`
- **Briefing tone & structure**: `engine/briefing.ts`
- **Action effects + war logic**: `engine/resolve.ts`, `engine/drift.ts`
- **Failure thresholds**: `engine/failure.ts`

## Debug: export full true state (server-only)

```bash
ENABLE_DEBUG_EXPORT=true npm run dev
```

Then call:
- `GET /api/game/debug/export?gameId=...`

Returns canonical world state + complete turn history for diagnostics/balancing.

## Tests

```bash
npm test
```

Includes a determinism smoke test to guarantee **same seed + same actions** → identical outcomes.

## LLM subsystem (server-only, optional)

The LLM layer is intentionally **thin** and **bounded**. It generates narrative and translates directives; it does **not** mutate world state directly.

### Provider selection (priority order)

1. **OpenAI** (`OPENAI_API_KEY`) — default for now
2. **Mistral** (`MISTRAL_API_KEY`) — hackathon target
3. **Gemini** (`GEMINI_API_KEY`)

### Mistral-first hackathon mode

Set Mistral credentials to enable the Mistral path. OpenAI still takes precedence if configured.

```bash
export MISTRAL_API_KEY="YOUR_KEY"
# optional
export MISTRAL_MODEL="mistral-small-latest"
npm run dev
```

### OpenAI (current default)

```bash
export OPENAI_API_KEY="YOUR_KEY"
# optional
export OPENAI_MODEL="gpt-4.1-mini"
npm run dev
```

### Gemini (fallback)

```bash
export GEMINI_API_KEY="YOUR_KEY"
# optional
export GEMINI_MODEL="gemini-2.5-flash-lite"
npm run dev
```

### LLM usage in this codebase

All LLM calls live in `db/llm.ts` and are structured as **strict JSON** with explicit schema validation in `db/llmSchemas.ts`.

Main flows:
- **Directive parsing** → structured actions (validated/clamped)
- **Briefing/event rewrites** → tone + grounding only
- **Resolution memo** → short narrative synthesis

> IMPORTANT: never hardcode keys or commit secrets.
