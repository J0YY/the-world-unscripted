"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot, PlayerAction } from "@/engine";
import { apiReset, apiSnapshot, apiSubmitTurn } from "@/components/api";
import { ActionConsole } from "@/components/ActionConsole";
import { EventsPanel } from "@/components/EventsPanel";
import { IndicatorCard } from "@/components/IndicatorCard";
import { WorldPulse } from "@/components/WorldPulse";
import { Button, Card } from "@/components/ui";
import { clearStoredGame, getStoredGameId, setLastFailure, setLastOutcome } from "@/components/storage";

export default function GameControlRoomPage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gameId = getStoredGameId();
    if (!gameId) {
      router.push("/");
      return;
    }
    apiSnapshot(gameId)
      .then((s) => {
        setSnap(s);
        if (s.status === "FAILED") router.push("/failure");
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const title = useMemo(() => (snap ? `${snap.countryProfile.name} — Turn ${snap.turn}` : "Control room"), [snap]);

  async function onSubmit(actions: PlayerAction[]) {
    const gameId = getStoredGameId();
    if (!gameId) return;
    const outcome = await apiSubmitTurn(gameId, actions);
    setLastOutcome(outcome);
    if (outcome.failure) {
      setLastFailure(outcome.failure);
      router.push("/failure");
    } else {
      router.push("/resolution");
    }
  }

  async function reset() {
    await apiReset();
    clearStoredGame();
    router.push("/");
  }

  if (error) return <Shell title={title}>{error}</Shell>;
  if (!snap) return <Shell title={title}>Loading…</Shell>;

  const ind = snap.playerView.indicators;

  return (
    <Shell title={title} right={<Button variant="danger" onClick={reset}>Reset</Button>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
        <WorldPulse briefing={snap.playerView.briefing} />

        <div className="flex flex-col gap-4">
          <Card className="h-full">
            <div className="text-sm font-semibold text-white">Situation briefing</div>
            <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-sm text-white/85 ring-1 ring-white/10">
              {snap.playerView.briefing.text}
            </pre>
          </Card>

          <EventsPanel events={snap.playerView.incomingEvents} />
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
          <IndicatorCard label="Legitimacy" metric={ind.legitimacy} />
          <IndicatorCard label="Public approval" metric={ind.publicApproval} />
          <IndicatorCard label="Elite cohesion" metric={ind.eliteCohesion} />
          <IndicatorCard label="Military loyalty" metric={ind.militaryLoyalty} />
          <IndicatorCard label="Economic stability" metric={ind.economicStability} />
          <IndicatorCard label="Inflation pressure" metric={ind.inflationPressure} />
          <IndicatorCard label="Unrest level" metric={ind.unrestLevel} />
          <IndicatorCard label="Intelligence clarity" metric={ind.intelligenceClarity} />
          <IndicatorCard label="International credibility" metric={ind.internationalCredibility} />
          <IndicatorCard label="Sovereignty integrity" metric={ind.sovereigntyIntegrity} />
          <IndicatorCard label="War status" metric={ind.warStatus} />
        </div>
      </div>

      <div className="mt-6">
        <ActionConsole templates={snap.actionTemplates} actionLimit={snap.actionLimit} onSubmit={onSubmit} />
      </div>
    </Shell>
  );
}

function Shell({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black px-6 py-10">
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs tracking-widest text-white/50">THE UNSCRIPTED WORLD ORDER</div>
            <div className="mt-2 text-2xl font-semibold text-white">{title}</div>
            <div className="mt-1 text-xs text-white/50">
              You are seeing estimates with confidence. True values are hidden.
            </div>
          </div>
          {right}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

