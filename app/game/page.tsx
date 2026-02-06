"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot } from "@/engine";
import { apiSnapshot, apiSubmitTurnWithDirective, apiTurnHistory } from "@/components/api";
import GlobalPressureFieldPage from "@/components/gpf/GlobalPressureFieldPage";
import { PromptConsole } from "@/components/PromptConsole";
import { getStoredGameId, setLastFailure, setLastOutcome } from "@/components/storage";

export default function GameControlRoomPage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [turns, setTurns] = useState<Array<{ turn: number; snapshot: GameSnapshot }>>([]);
  const [turnIdx, setTurnIdx] = useState<number>(-1);
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
    Promise.all([apiSnapshot(gameId), apiTurnHistory(gameId)])
      .then(([latest, hist]) => {
        const all = hist.turns ?? [];
        // Ensure latest snapshot is present.
        const byTurn = new Map<number, GameSnapshot>(all.map((t) => [t.turn, t.snapshot]));
        byTurn.set(latest.turn, latest);
        const merged = Array.from(byTurn.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([turn, snapshot]) => ({ turn, snapshot }));
        setTurns(merged);
        const idx = merged.findIndex((t) => t.turn === latest.turn);
        setTurnIdx(idx >= 0 ? idx : merged.length - 1);
        setSnap(latest);
        if (latest.status === "FAILED") router.push("/failure");
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const title = useMemo(() => (snap ? `${snap.countryProfile.name} — Turn ${snap.turn}` : "Control room"), [snap]);

  const gameId = useMemo(() => getStoredGameId(), []);

  function viewTurnAt(nextIdx: number) {
    const t = turns[nextIdx];
    if (!t) return;
    setTurnIdx(nextIdx);
    setSnap(t.snapshot);
  }

  async function onSubmitDirective(directive: string) {
    const gameId = getStoredGameId();
    if (!gameId) return;
    const outcome = await apiSubmitTurnWithDirective(gameId, [], directive.trim());
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
            // Reserve space so the sticky prompt console doesn't cover content.
            <div className="h-[28vh]" />
          }
        />
      </Shell>

      {gameId && snap ? (
        <PromptConsole
          gameId={gameId}
          llmMode={snap.llmMode}
          disabled={turnIdx >= 0 && turnIdx < turns.length - 1}
          onSubmitDirective={onSubmitDirective}
          turnLabel={`Turn ${snap.turn}`}
          autoSuggest={false}
          canGoPrev={turnIdx > 0}
          canGoNext={turnIdx >= 0 && turnIdx < turns.length - 1}
          onPrev={() => viewTurnAt(Math.max(0, turnIdx - 1))}
          onNext={() => viewTurnAt(Math.min(turns.length - 1, turnIdx + 1))}
        />
      ) : null}

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

