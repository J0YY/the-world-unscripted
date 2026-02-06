"use client";

import { useEffect, useMemo, useState } from "react";
import { Send, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

type SuggestPayload = {
  situation: { headline: string; keyDevelopments: string[] };
  suggestions: string[];
  redFlags: string[];
  questions: string[];
};

export function PromptConsole({
  gameId,
  llmMode,
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
  const [suggest, setSuggest] = useState<SuggestPayload | null>(null);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const placeholder = useMemo(
    () =>
      "Type your directive. Example: Quietly reassure the EU we’ll allow inspections, while preparing a limited mobilization and targeted subsidies to prevent weekend unrest.",
    [],
  );

  async function refreshSuggestions() {
    if (llmMode !== "ON") return;
    setSuggestLoading(true);
    setSuggestErr(null);
    try {
      const res = await fetch("/api/game/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      const data = (await res.json()) as SuggestPayload | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || `Suggest failed (${res.status})`);
      setSuggest(data as SuggestPayload);
    } catch (e) {
      setSuggestErr((e as Error).message);
      setSuggest(null);
    } finally {
      setSuggestLoading(false);
    }
  }

  useEffect(() => {
    // Refresh when turn changes (or when console becomes active).
    void refreshSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, turnLabel, llmMode]);

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

  return (
    <div className="prompt-console fixed inset-x-0 bottom-0 z-[60] h-[26vh] border-t border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 backdrop-blur overflow-hidden">
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

          {llmMode === "ON" ? (
            <button
              type="button"
              onClick={() => void refreshSuggestions()}
              disabled={suggestLoading}
              className="inline-flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-600 disabled:opacity-50"
              aria-label="Refresh AI suggestions"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {suggestLoading ? "Generating…" : "Suggestions"}
            </button>
          ) : (
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-500)]">AI OFF</div>
          )}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr] flex-1 min-h-0">
          <div className="min-h-0 overflow-y-auto rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-3">
            {llmMode !== "ON" ? (
              <div className="text-xs font-mono text-[var(--ds-gray-700)]">
                AI is offline. You can still type directives, but they won’t be translated into operations.
              </div>
            ) : suggestErr ? (
              <div className="text-xs font-mono text-[var(--ds-red-700)]">Suggestions error: {suggestErr}</div>
            ) : !suggest ? (
              <div className="text-xs font-mono text-[var(--ds-gray-700)]">Generating suggestions…</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Situation</div>
                  <div className="mt-1 text-xs font-mono text-[var(--ds-gray-1000)]">{suggest.situation.headline}</div>
                  <ul className="mt-2 space-y-1">
                    {suggest.situation.keyDevelopments.map((d) => (
                      <li key={d} className="text-[11px] font-mono text-[var(--ds-gray-800)]">
                        - {d}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Suggested directives</div>
                  <ul className="mt-2 space-y-1">
                    {suggest.suggestions.map((s) => (
                      <li key={s} className="text-[11px] font-mono text-[var(--ds-gray-900)]">
                        - {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {suggest.redFlags.length ? (
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Red flags</div>
                    <ul className="mt-2 space-y-1">
                      {suggest.redFlags.map((r) => (
                        <li key={r} className="text-[11px] font-mono text-[var(--ds-red-700)]">
                          - {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-3 flex flex-col min-h-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Directive</div>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder={placeholder}
              rows={4}
              className="mt-2 w-full flex-1 min-h-0 resize-none rounded bg-[var(--ds-background-100)] px-3 py-2 text-xs font-mono text-[var(--ds-gray-1000)] outline-none ring-1 ring-[var(--ds-gray-alpha-200)] placeholder:text-[var(--ds-gray-500)]"
              disabled={disabled || submitting}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-mono text-[var(--ds-gray-600)]">
                {disabled ? "History view is read-only." : "Enter to submit."}
              </div>
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
  );
}

