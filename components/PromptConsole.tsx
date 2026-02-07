"use client";

import { useEffect, useMemo, useState } from "react";
import { Send, ChevronLeft, ChevronRight, Dice5 } from "lucide-react";
import { motion } from "framer-motion";
import type { GameSnapshot } from "@/engine";
import { apiTimeline } from "@/components/api";

type TimelinePayload = {
  items: Array<{ turnNumber: number; directive: string | null; headline: string; bullets: string[]; incoming: string[] }>;
};

export function PromptConsole({
  gameId,
  llmMode,
  snapshot,
  disabled,
  onSubmitDirective,
  turnLabel,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: {
  gameId: string;
  llmMode?: "ON" | "OFF";
  snapshot: GameSnapshot;
  disabled?: boolean;
  onSubmitDirective: (directive: string) => Promise<void>;
  turnLabel: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [directive, setDirective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [timelineErr, setTimelineErr] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const placeholder = useMemo(
    () =>
      "Type your directive. Be specific about what you want to achieve, who you want to influence, and what you want to happen next.",
    [],
  );

  async function refreshTimeline() {
    setTimelineLoading(true);
    setTimelineErr(null);
    try {
      const data = (await apiTimeline(gameId, { limit: 8 })) as TimelinePayload;
      setTimeline(data);
    } catch (e) {
      setTimelineErr((e as Error).message);
      setTimeline(null);
    } finally {
      setTimelineLoading(false);
    }
  }

  useEffect(() => {
    void refreshTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, turnLabel]);

  async function submit() {
    if (!directive.trim() || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmitDirective(directive.trim());
      setDirective("");
    } finally {
      setSubmitting(false);
    }
  }

  const timelineTop = timeline?.items?.[0] ?? null;

  const autoFillOptions = useMemo(() => {
    const c = snapshot.countryProfile.name;
    const n1 = snapshot.countryProfile.neighbors?.[0] ?? "a neighbor";
    const n2 = snapshot.countryProfile.neighbors?.[1] ?? "another neighbor";
    const h = String(timelineTop?.headline || snapshot.playerView.briefing.headlines?.[0] || "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    return [
      `Announce fuel + staples relief; open IMF backchannel; task intel to trace: "${h}".`,
      `Offer EU inspections-for-sanctions pause; tighten port + border controls; move reserves vs ${n1}.`,
      `Fire the finance minister; freeze bread + fuel prices for 14 days; arrest one flagship profiteer.`,
      `Secure emergency shipments; deploy crowd-control to the capital; open a hotline with ${n2}.`,
      `Propose a 7-day stand-down corridor; demand trade-route guarantees; prep retaliation plan.`,
    ];
  }, [snapshot.countryProfile.name, snapshot.countryProfile.neighbors, snapshot.playerView.briefing.headlines, timelineTop?.headline]);

  function autofill() {
    const pick = autoFillOptions[Math.floor(Math.random() * autoFillOptions.length)] ?? "";
    if (!pick) return;
    setDirective(pick);
  }

  return (
    <div className="prompt-console fixed inset-x-0 bottom-0 z-[60] h-[24vh] border-t border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 backdrop-blur overflow-hidden">
      {submitting ? (
        <motion.div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          aria-live="polite"
        >
          <div className="w-full max-w-xl px-6">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/60">Resolving turn</div>
            <div className="mt-4 text-4xl font-semibold text-white">GENERATING OUTCOME</div>
            <motion.ul
              className="mt-5 space-y-2 text-sm text-white/80 font-mono"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
            >
              {[
                "Interpreting directive…",
                "Selecting operations…",
                "Applying second-order effects…",
                "Updating perceptions…",
                "Compiling brief…",
              ].map((t) => (
                <motion.li key={t} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}>
                  - {t}
                </motion.li>
              ))}
            </motion.ul>
            <div className="mt-6 h-1 w-full bg-white/10 rounded overflow-hidden">
              <div className="h-full w-1/3 bg-white/60 animate-pulse" />
            </div>
            <div className="mt-3 text-xs text-white/50 font-mono">This can take ~10–20 seconds when AI is online.</div>
          </div>
        </motion.div>
      ) : null}
      <div className="mx-auto h-full w-full max-w-[1800px] px-4 md:px-6 py-3 flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canGoPrev}
              className="inline-flex items-center justify-center rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-2 py-1 text-xs font-mono text-[var(--ds-gray-900)] disabled:opacity-40"
              aria-label="Previous turn"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="text-xs font-mono text-[var(--ds-gray-900)]">
              <span className="uppercase opacity-70">Command Deck</span>{" "}
              <span className="opacity-50">/</span> <span className="tabular-nums">{turnLabel}</span>
              {disabled ? <span className="ml-2 text-[10px] uppercase opacity-60">(viewing history)</span> : null}
            </div>
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoNext}
              className="inline-flex items-center justify-center rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-2 py-1 text-xs font-mono text-[var(--ds-gray-900)] disabled:opacity-40"
              aria-label="Next turn"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-500)]">
            {llmMode === "ON" ? "AI ON" : "AI OFF"}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 flex-1 min-h-0">
          <details className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] px-3 py-2">
            <summary className="cursor-pointer select-none">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Timeline</div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void refreshTimeline();
                  }}
                  disabled={timelineLoading}
                  className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-800)] disabled:opacity-50"
                >
                  {timelineLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </summary>
            {timelineErr ? <div className="mt-2 text-xs font-mono text-[var(--ds-red-700)]">Timeline error: {timelineErr}</div> : null}
            {!timeline ? (
              <div className="mt-2 text-xs font-mono text-[var(--ds-gray-700)]">
                {timelineLoading ? "Loading timeline…" : "No timeline available yet."}
              </div>
            ) : (
              <ul className="mt-2 space-y-2 max-h-[10vh] overflow-y-auto pr-1">
                {timeline.items.map((it) => (
                  <li
                    key={`${it.turnNumber}-${it.headline}`}
                    className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-2"
                  >
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Turn {it.turnNumber}</div>
                    <div className="mt-1 text-[11px] font-mono text-[var(--ds-gray-1000)]">{it.headline}</div>
                    {it.directive ? (
                      <div className="mt-1 text-[11px] font-mono text-[var(--ds-gray-800)]">
                        <span className="opacity-60">Directive:</span> {it.directive}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-3 flex flex-col min-h-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Directive</div>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder={placeholder}
              rows={4}
              className="mt-2 w-full flex-1 min-h-0 resize-none rounded bg-[var(--ds-background-100)] px-3 py-3 text-sm md:text-base leading-relaxed font-mono text-[var(--ds-gray-1000)] outline-none ring-1 ring-[var(--ds-gray-alpha-200)] placeholder:text-[var(--ds-gray-500)]"
              disabled={disabled || submitting}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-mono text-[var(--ds-gray-600)]">
                {disabled ? "History view is read-only." : "Enter to submit."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => autofill()}
                  disabled={disabled || submitting}
                  className="inline-flex items-center gap-2 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-3 py-2 text-xs font-mono text-[var(--ds-gray-900)] disabled:opacity-40"
                >
                  <Dice5 className="h-3.5 w-3.5" />
                  Autofill
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={disabled || submitting || !directive.trim()}
                  className="inline-flex items-center gap-2 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-3 py-2 text-xs font-mono text-[var(--ds-gray-1000)] disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "Submitting…" : "End turn"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

