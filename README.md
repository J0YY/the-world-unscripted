# The Unscripted World Order (MVP)

A **serious, grounded** turn-based geopolitical simulation. You are President of a fictional country operating inside the **real** international system (UN/IMF-style pressure, sanctions logic, alliance dynamics). You never see truth—only **estimates + confidence**.

Failure is explicit:
- **Domestic ouster**: legitimacy collapse + elite fracture / unrest / loyalty failure
- **Loss of sovereignty**: annexation/protectorate dynamics (capital control / sovereignty integrity collapse)

War is permitted and can be attractive—but it carries compounding systemic costs.

## Run locally

### Prereqs
- Node 20+

### Commands

```bash
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

### Reset
- Use the **Reset Simulation** button on the Start screen (deletes all local games + turn logs).
- Or call `POST /api/game/reset`.

## Architecture (3 layers)

### A) Simulation Engine (UI-agnostic)
- Location: `engine/`
- Pure TypeScript, deterministic when seeded
- Owns:
  - **True** `WorldState`
  - Player-facing **noisy** `GameSnapshot` (`PlayerViewState` with confidence)
  - Turn pipeline: briefing → events → actions → resolution → delayed consequences → drift → failure detection

Key entrypoints:
- `engine/createNewGameWorld(seed)`
- `engine/submitTurnAndAdvance(gameId, world, actions)`

### B) Persistence layer (SQLite via Prisma)
- Location: `db/`
- Prisma schema: `db/prisma/schema.prisma`
- Stores:
  - full **true state per turn** (`TurnLog.worldState`)
  - last **player snapshot** (`Game.lastPlayerSnapshot`)
  - briefing/events/actions/outcome log

### C) UI layer (Next.js App Router)
- Location: `app/` + `components/`
- Renders **player snapshots only** (never true state)
- Screens:
  - Start (`/`)
  - Country Profile (`/country`)
  - Main Control Room (`/game`)
  - Resolution (`/resolution`)
  - Failure (`/failure`)

## Where to change content

- **Incoming events**: `engine/events.ts`
- **Briefing tone/content**: `engine/briefing.ts`
- **Action effects + war logic**: `engine/resolve.ts` and `engine/drift.ts`
- **Failure thresholds**: `engine/failure.ts`

## Debug: export true state (server-only, behind a flag)

Set an env var when running dev:

```bash
ENABLE_DEBUG_EXPORT=true npm run dev
```

Then call:
- `GET /api/game/debug/export?gameId=...`

This returns true world state + full turn history (for debugging / balancing). Do not expose this in production.

## Minimal tests

```bash
npm test
```

Includes a determinism smoke test to ensure **same seed + same actions** produces identical outcomes.

## Optional: LLM mode (dynamic narrative + freeform directives)

This MVP can optionally use an LLM **server-side** to:
- rewrite each turn’s **briefing + event descriptions** (grounded tone)
- translate a player **freeform directive** into structured actions (still validated/clamped)
- optionally inject **one bounded event** per turn (effects are limited and validated)

Enable it by setting:

```bash
export OPENAI_API_KEY="YOUR_KEY"
# optional
export OPENAI_MODEL="gpt-4.1-mini"
npm run dev
```

Important: do **not** hardcode keys in code or commit them to git.
