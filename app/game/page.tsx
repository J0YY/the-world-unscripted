"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot, PlayerAction } from "@/engine";
import { apiReset, apiSnapshot, apiSubmitTurn, apiSubmitTurnWithDirective } from "@/components/api";
import { ActionConsole } from "@/components/ActionConsole";
import GlobalPressureFieldPage from "@/components/gpf/GlobalPressureFieldPage";
import { Button } from "@/components/ui";
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

  async function onSubmit(actions: PlayerAction[], directive: string) {
    const gameId = getStoredGameId();
    if (!gameId) return;
    const outcome = directive?.trim()
      ? await apiSubmitTurnWithDirective(gameId, actions, directive.trim())
      : await apiSubmitTurn(gameId, actions);
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

  return (
    <Shell title={title} right={<Button variant="danger" onClick={reset}>Reset</Button>}>
      <GlobalPressureFieldPage
        snapshot={snap}
        bottomSlot={
          <div className="border border-[var(--ds-gray-alpha-200)] rounded bg-[var(--ds-gray-alpha-100)] p-3">
            <ActionConsole templates={snap.actionTemplates} actionLimit={snap.actionLimit} onSubmit={onSubmit} />
          </div>
        }
      />
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
    <div className="min-h-screen bg-[var(--ds-background-100)] px-0 py-0">
      <div className="mx-auto w-full max-w-[1800px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="sr-only">THE UNSCRIPTED WORLD ORDER</div>
            <div className="sr-only">{title}</div>
          </div>
          {right}
        </div>
        {children}
      </div>
    </div>
  );
}

