"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot, PlayerAction } from "@/engine";
import { apiSnapshot, apiSubmitTurn, apiSubmitTurnWithDirective } from "@/components/api";
import { ActionConsole } from "@/components/ActionConsole";
import GlobalPressureFieldPage from "@/components/gpf/GlobalPressureFieldPage";
import { getStoredGameId, setLastFailure, setLastOutcome } from "@/components/storage";

export default function GameControlRoomPage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFadingIn, setIsFadingIn] = useState(true);

  useEffect(() => {
    // Slow dramatic fade-in when entering the control room.
    const t = setTimeout(() => setIsFadingIn(false), 50);
    return () => clearTimeout(t);
  }, []);

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

  if (error) return <Shell title={title}>{error}</Shell>;
  if (!snap) return <Shell title={title}>Loading…</Shell>;

  return (
    <>
      <Shell title={title} llmMode={snap.llmMode}>
        <GlobalPressureFieldPage
          snapshot={snap}
          bottomSlot={
            <div className="action-console border border-[var(--ds-gray-alpha-200)] rounded bg-[var(--ds-gray-alpha-100)] p-3">
              <ActionConsole templates={snap.actionTemplates} actionLimit={snap.actionLimit} onSubmit={onSubmit} />
            </div>
          }
        />
      </Shell>

      <div
        className="fixed inset-0 z-[100] bg-black transition-opacity duration-[2600ms] ease-in-out pointer-events-none"
        style={{ opacity: isFadingIn ? 1 : 0 }}
        aria-hidden="true"
      />
    </>
  );
}

function Shell({
  title,
  children,
  llmMode,
}: {
  title: string;
  children: React.ReactNode;
  llmMode?: "ON" | "OFF";
}) {
  return (
    <div className="min-h-screen bg-[var(--ds-background-100)] px-0 py-0 font-mono [--font-sans:var(--font-mono)]">
      <div className="mx-auto w-full max-w-[1800px]">
        {/* Header / Top Bar */}
        <div className="pointer-events-none fixed top-4 right-4 z-50 flex items-center gap-2 mix-blend-difference">
           {llmMode && (
             <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
               llmMode === "ON" 
                 ? "border-emerald-500/50 text-emerald-400 bg-emerald-950/30" 
                 : "border-neutral-500/50 text-neutral-500 bg-neutral-900/30"
             }`}>
                <div className={`h-1.5 w-1.5 rounded-full ${llmMode === "ON" ? "bg-emerald-400 animate-pulse" : "bg-neutral-600"}`} />
                AI {llmMode}
             </div>
           )}
        </div>
        
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="sr-only">THE UNSCRIPTED WORLD ORDER</div>
            <div className="sr-only">{title}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

