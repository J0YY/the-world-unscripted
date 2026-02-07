"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot, TurnOutcome } from "@/engine";
import { apiResolutionReport, apiSnapshot, apiSubmitTurnWithDirective } from "@/components/api";
import GlobalPressureFieldPage from "@/components/gpf/GlobalPressureFieldPage";
import { PromptConsole } from "@/components/PromptConsole";
import { getStoredGameId, setLastFailure, setLastOutcome } from "@/components/storage";
import AfterActionModal from "@/components/AfterActionModal";

export default function GameControlRoomPage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFadingIn, setIsFadingIn] = useState(true);
  const [afterActionOpen, setAfterActionOpen] = useState(false);
  const [afterActionOutcome, setAfterActionOutcome] = useState<TurnOutcome | null>(null);
  const [afterActionDirective, setAfterActionDirective] = useState<string>("");

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
      .then((latest) => {
        setSnap(latest);
        if (latest.status === "FAILED") router.push("/failure");
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const title = useMemo(() => (snap ? `${snap.countryProfile.name} — Turn ${snap.turn}` : "Control room"), [snap]);

  const gameId = useMemo(() => getStoredGameId(), []);

  async function onSubmitDirective(directive: string) {
    const gameId = getStoredGameId();
    if (!gameId) return;
    const outcome = await apiSubmitTurnWithDirective(gameId, [], directive.trim());
    setLastOutcome(outcome);
    if (outcome.failure) {
      setLastFailure(outcome.failure);
      router.push("/failure");
    } else {
      // Advance UI to next snapshot immediately (next turn), and show an after-action modal overlay.
      setAfterActionOutcome(outcome);
      setAfterActionDirective(directive.trim());
      setAfterActionOpen(true);

      const next = outcome.nextSnapshot;
      setSnap(next);

      // Start the expensive LLM work immediately and concurrently:
      // - resolution narrative for the resolved turn (for AfterAction modal)
      // - next snapshot hydration (Turn N+1 briefing/events)
      // This overlaps LLM latency with the time the user is reading the modal.
      void apiResolutionReport(gameId, outcome.turnResolved, { forceLlm: true }).catch(() => {});
      void apiSnapshot(gameId).then(setSnap).catch(() => {});
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
            <div style={{ height: "var(--prompt-console-h, 22vh)" }} />
          }
        />
      </Shell>

      {gameId && afterActionOpen && afterActionOutcome ? (
        <AfterActionModal
          open={true}
          gameId={gameId}
          outcome={afterActionOutcome}
          directiveText={afterActionDirective}
          llmMode={snap.llmMode}
          onClose={() => setAfterActionOpen(false)}
        />
      ) : null}

      {gameId && snap ? (
        <PromptConsole
          gameId={gameId}
          llmMode={snap.llmMode}
          snapshot={snap}
          onSubmitDirective={onSubmitDirective}
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

