"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { TurnOutcome } from "@/engine";
import { apiResolutionReport } from "@/components/api";

type ResolutionReport = {
  turnNumber: number;
  directive: string | null;
  translatedActions: Array<{ kind: string; summary: string }>;
  publicResolution: string;
  consequences: string[];
  signalsUnknown: string[];
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  llm?: { headline?: string; narrative?: string[] };
};

export default function AfterActionModal({
  open,
  gameId,
  outcome,
  llmMode,
  onClose,
}: {
  open: boolean;
  gameId: string;
  outcome: TurnOutcome | null;
  llmMode?: "ON" | "OFF";
  onClose: () => void;
}) {
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceErr, setEnhanceErr] = useState<string | null>(null);

  const baseLines = useMemo(() => {
    if (!outcome) return [];
    return outcome.publicResolutionText.split("\n").filter(Boolean).slice(0, 18);
  }, [outcome]);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setEnhancing(false);
    setEnhanceErr(null);
  }, [open]);

  async function enhanceWithAi() {
    if (!outcome) return;
    if (llmMode !== "ON") return;
    setEnhancing(true);
    setEnhanceErr(null);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    try {
      const r = (await apiResolutionReport(gameId, outcome.turnResolved, { signal: ac.signal, forceLlm: true })) as ResolutionReport;
      setReport(r);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setEnhanceErr((e as Error).message);
      } else {
        setEnhanceErr("AI narrative is taking too long (timed out). Try again.");
      }
    } finally {
      clearTimeout(t);
      setEnhancing(false);
    }
  }

  if (!open || !outcome) return null;

  const headline = report?.llm && typeof report.llm === "object" && "headline" in report.llm && typeof report.llm.headline === "string"
    ? report.llm.headline
    : `Turn ${outcome.turnResolved} — After Action`;

  const narrative =
    report?.llm && typeof report.llm === "object" && Array.isArray(report.llm.narrative)
      ? report.llm.narrative.slice(0, 18)
      : baseLines;

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        className="w-full max-w-4xl rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/50">After Action</div>
            <div className="mt-2 text-2xl font-semibold text-white">{headline}</div>
            <div className="mt-1 text-xs text-white/60 font-mono">You are now in Turn {outcome.nextSnapshot.turn}.</div>
          </div>
          <div className="flex items-center gap-2">
            {llmMode === "ON" ? (
              <button
                type="button"
                onClick={() => void enhanceWithAi()}
                disabled={enhancing}
                className="rounded border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-emerald-300 disabled:opacity-50"
              >
                {enhancing ? "Enhancing…" : "Enhance w/ AI"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-white/80 hover:bg-white/10"
            >
              Continue
            </button>
          </div>
        </div>

        {enhanceErr ? <div className="mt-3 text-xs font-mono text-red-300">AI: {enhanceErr}</div> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/50">Directive</div>
            <div className="mt-2 text-sm text-white/85 whitespace-pre-wrap">{report?.directive ?? "(see history log)"}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/50">Narrative</div>
            <motion.ul
              className="mt-2 space-y-2"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
            >
              {narrative.map((line) => (
                <motion.li
                  key={line}
                  variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                  className="text-sm text-white/85"
                >
                  {line}
                </motion.li>
              ))}
            </motion.ul>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

