"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot, TurnOutcome } from "@/engine";
import type { MapMode } from "@/components/gpf/types";
import { apiResolutionReport, apiSnapshot, apiSubmitTurnWithDirective } from "@/components/api";
import GlobalPressureFieldPage from "@/components/gpf/GlobalPressureFieldPage";
import { PromptConsole } from "@/components/PromptConsole";
import { getStoredGameId, setLastFailure, setLastOutcome } from "@/components/storage";
import AfterActionModal from "@/components/AfterActionModal";
import WarRoomCinematic from "@/components/gpf/WarRoomCinematic";

function needsHydration(s: GameSnapshot | null): boolean {
  if (!s) return false;
  if (s.llmMode !== "ON") return false;
  const briefing = s.playerView?.briefing;
  const incoming = s.playerView?.incomingEvents ?? [];
  const headlines = Array.isArray(briefing?.headlines) ? briefing.headlines : [];
  const intel = Array.isArray(briefing?.intelBriefs) ? briefing.intelBriefs : [];
  const dip = Array.isArray(briefing?.diplomaticMessages) ? briefing.diplomaticMessages : [];
  const rum = Array.isArray(briefing?.domesticRumors) ? briefing.domesticRumors : [];
  // Slim briefing target: 2 intercepts + 1 cable + 2 headlines + 1 rumor, plus events.
  return incoming.length === 0 || headlines.length < 2 || intel.length < 2 || dip.length < 1 || rum.length < 1;
}

export default function GameControlRoomPage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFadingIn, setIsFadingIn] = useState(true);
  const [afterActionOpen, setAfterActionOpen] = useState(false);
  const [afterActionOutcome, setAfterActionOutcome] = useState<TurnOutcome | null>(null);
  const [afterActionDirective, setAfterActionDirective] = useState<string>("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [cinematicActive, setCinematicActive] = useState(false);
  const [cinematicTurn, setCinematicTurn] = useState(1);
  const cinematicCallbackRef = useRef<(() => void) | null>(null);
  const hydrationPollTokenRef = useRef(0);
  const lastWorldEventsAlertWindowRef = useRef<number | null>(null);

  async function pollHydrationUntilReady(
    gameId: string,
    opts?: {
      maxMs?: number;
      delaysMs?: number[];
      onFirst200?: () => void;
    },
  ): Promise<GameSnapshot | null> {
    const token = ++hydrationPollTokenRef.current;
    const maxMs = typeof opts?.maxMs === "number" && Number.isFinite(opts.maxMs) ? opts.maxMs : 45_000;
    const startedAt = Date.now();
    const delaysMs = Array.isArray(opts?.delaysMs) && opts!.delaysMs.length ? opts!.delaysMs : [900, 1200, 1600, 2200, 3000, 4200, 6000, 8500, 10_000];
    let didAny200 = false;
    let last: GameSnapshot | null = null;

    // Staggered poll: quick early checks, then back off hard.
    for (let i = 0; Date.now() - startedAt < maxMs; i++) {
      if (hydrationPollTokenRef.current !== token) return last;

      const delay = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 2000;
      const extraHiddenDelay = typeof document !== "undefined" && document.hidden ? 6000 : 0;
      await new Promise((r) => setTimeout(r, delay + extraHiddenDelay));

      if (hydrationPollTokenRef.current !== token) return last;

      const s = await apiSnapshot(gameId);
      if (hydrationPollTokenRef.current !== token) return last;
      setSnap(s);
      last = s;
      if (!didAny200) {
        didAny200 = true;
        opts?.onFirst200?.();
      }
      if (!needsHydration(s)) break;
    }
    return last;
  }

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
    let stopped = false;
    const load = async () => {
      try {
        const latest = await apiSnapshot(gameId);
        if (stopped) return;
        setSnap(latest);
        if (latest.status === "FAILED") router.push("/failure");
        if (!needsHydration(latest)) return;
        await pollHydrationUntilReady(gameId);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      stopped = true;
      hydrationPollTokenRef.current++;
    };
  }, [router]);

  const topHeadline = useMemo(() => {
    const headline = snap?.playerView?.briefing?.headlines?.[0];
    return typeof headline === "string" ? headline.trim() : "";
  }, [snap]);

  const alertWindowKey = useMemo(() => {
    return snap?.gameId ? `twuo:worldEventsAlertWindow:${snap.gameId}` : null;
  }, [snap?.gameId]);

  useEffect(() => {
    if (!alertWindowKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(alertWindowKey);
    const parsed = raw ? Number(raw) : NaN;
    lastWorldEventsAlertWindowRef.current = Number.isFinite(parsed) ? parsed : null;
  }, [alertWindowKey]);

  const title = useMemo(() => (snap ? `${snap.countryProfile.name} — Turn ${snap.turn}` : "Control room"), [snap]);

  const gameId = useMemo(() => getStoredGameId(), []);

  async function onSubmitDirective(
    directive: string,
    onProgress?: (p: { completed: number; total: number; label: string }) => void,
  ) {
    const gameId = getStoredGameId();
    if (!gameId) return;
    onProgress?.({ completed: 0, total: 3, label: "Submitting directive…" });
    const outcome = await apiSubmitTurnWithDirective(gameId, [], directive.trim());
    onProgress?.({ completed: 1, total: 3, label: "Turn resolved." });
    setLastOutcome(outcome);
    if (outcome.failure) {
      setLastFailure(outcome.failure);
      router.push("/failure");
    } else {
      // Play the war-room cinematic transition, THEN show after-action modal.
      const next = outcome.nextSnapshot;
      setCinematicTurn(next.turn);

      // Wrap the post-cinematic work in a ref so onComplete can call it.
      cinematicCallbackRef.current = () => {
        setAfterActionOutcome(outcome);
        setAfterActionDirective(directive.trim());
        setAfterActionOpen(true);
        setSnap(next);
      };
      setCinematicActive(true);

      // Poll snapshot briefly to pick up hydrated events/briefing (bounded so UI never "hangs").
      if (needsHydration(next)) {
        onProgress?.({ completed: 1, total: 3, label: "Hydrating brief…" });
        const last = await pollHydrationUntilReady(gameId, {
          maxMs: 14_000,
          delaysMs: [650, 850, 1100, 1400, 1800, 2400, 3200],
          onFirst200: () => onProgress?.({ completed: 2, total: 3, label: "Brief arriving…" }),
        }).catch(() => null);
        // Whether or not hydration finished, don't leave the overlay stuck.
        const hydrated = !!last && !needsHydration(last);
        onProgress?.({ completed: 3, total: 3, label: hydrated ? "Brief ready." : "Continuing in background…" });
        // If we timed out before hydration completed, keep polling slowly in the background
        // so the UI still updates once the LLM finishes (but without spamming requests).
        if (!hydrated) {
          void pollHydrationUntilReady(gameId, { maxMs: 45_000, delaysMs: [6000, 9000, 12_000, 15_000] }).catch(() => {});
        }
      } else {
        onProgress?.({ completed: 3, total: 3, label: "Brief ready." });
      }
    }
  }

  function handleGpfModeChange(nextMode: MapMode) {
    if (nextMode !== "world-events") return;
    if (!snap || !topHeadline) return;
    if (snap.turn < 3) return;
    const windowIndex = Math.floor((snap.turn - 1) / 3);
    if (lastWorldEventsAlertWindowRef.current === windowIndex) return;
    lastWorldEventsAlertWindowRef.current = windowIndex;
    if (alertWindowKey && typeof window !== "undefined") {
      window.localStorage.setItem(alertWindowKey, String(windowIndex));
    }
    setAlertOpen(true);
  }

  if (error) return <Shell title={title}>{error}</Shell>;
  if (!snap) return <Shell title={title}>Loading…</Shell>;

  const handleCinematicComplete = () => {
    setCinematicActive(false);
    cinematicCallbackRef.current?.();
    cinematicCallbackRef.current = null;
  };

  return (
    <>
      <WarRoomCinematic
        turn={cinematicTurn}
        active={cinematicActive}
        onComplete={handleCinematicComplete}
        countryName={snap.countryProfile.name}
      />

      <Shell title={title} llmMode={snap.llmMode}>
        <GlobalPressureFieldPage
          snapshot={snap}
          onModeChange={handleGpfModeChange}
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

      {snap && topHeadline && alertOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/85 to-black/90 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-red-500/80 bg-red-950/70 text-white shadow-[0_0_40px_rgba(239,68,68,0.35)]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(239,68,68,0.25) 0px, rgba(239,68,68,0.25) 10px, rgba(0,0,0,0.0) 10px, rgba(0,0,0,0.0) 22px)",
            }}
            role="alertdialog"
            aria-live="assertive"
            aria-label="Critical intelligence alert"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 via-red-300 to-red-600 animate-pulse" />
            <div className="flex items-start justify-between gap-3 border-b border-red-400/50 bg-black/70 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.4em] text-red-200/90">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_12px_rgba(239,68,68,0.9)] animate-pulse" />
                  Critical Alert
                </div>
                <div className="mt-1 text-lg font-semibold text-red-100">CLASSIFIED INFORMATION</div>
              </div>
              <button
                type="button"
                onClick={() => setAlertOpen(false)}
                className="rounded-full border border-red-300/60 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-red-100 hover:bg-red-500/20"
                aria-label="Dismiss alert"
              >
                Dismiss
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.25em] text-red-100/80">
                <span className="rounded border border-red-300/60 bg-red-500/20 px-2 py-1">Severity 2</span>
                <span className="rounded border border-red-300/60 bg-red-500/20 px-2 py-1">Priority: Immediate</span>
              </div>

              <div className="mt-4 rounded-lg border border-red-400/40 bg-black/60 p-4 shadow-[inset_0_0_20px_rgba(239,68,68,0.15)]">
                <div className="text-[10px] uppercase tracking-[0.35em] text-red-100/80">Top Briefing</div>
                <div className="mt-2 text-base leading-relaxed text-white">{topHeadline}</div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-red-100/80">
                <div>
                  FROM: {snap.countryProfile.name.toUpperCase()} INTELLIGENCE DIRECTORATE
                </div>
                <div>TO: NATIONAL SECURITY COUNCIL</div>
              </div>
            </div>
          </div>
        </div>
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

