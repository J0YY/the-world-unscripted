"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { GameSnapshot, TurnOutcome } from "@/engine";
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
  beforeSnapshot,
  directiveText,
  llmMode,
  onClose,
}: {
  open: boolean;
  gameId: string;
  outcome: TurnOutcome | null;
  beforeSnapshot: GameSnapshot | null;
  directiveText: string;
  llmMode?: "ON" | "OFF";
  onClose: () => void;
}) {
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceErr, setEnhanceErr] = useState<string | null>(null);

  const baseLines = useMemo(() => {
    if (!outcome) return [];
    return outcome.publicResolutionText.split("\n").filter(Boolean).slice(0, 18);
  }, [outcome]);

  const shownDirective = useMemo(() => {
    const d = directiveText?.trim() ? directiveText.trim() : report?.directive ?? "";
    return d;
  }, [directiveText, report?.directive]);

  const openingLines = useMemo(() => {
    const lines: string[] = [];
    if (shownDirective) {
      lines.push(`Directive executed: ${shownDirective}`);
    }
    if (report?.translatedActions?.length) {
      const ops = report.translatedActions.slice(0, 2).map((a) => a.summary);
      lines.push(`Operations: ${ops.join(" + ")}`);
    }
    return lines;
  }, [shownDirective, report?.translatedActions]);

  const narrative = useMemo(() => {
    if (!outcome) return [];
    if (report?.llm && typeof report.llm === "object" && Array.isArray(report.llm.narrative)) {
      return [...openingLines, ...report.llm.narrative].slice(0, 18);
    }
    return [...openingLines, ...baseLines].slice(0, 18);
  }, [outcome, report?.llm, openingLines, baseLines]);

  const statChanges = useMemo(() => {
    if (!beforeSnapshot) return [];
    if (!outcome) return [];
    const b = beforeSnapshot.playerView.indicators;
    const a = outcome.nextSnapshot.playerView.indicators;
    const rows = [
      { k: "Legitimacy", before: b.legitimacy.estimatedValue, after: a.legitimacy.estimatedValue },
      { k: "Elite cohesion", before: b.eliteCohesion.estimatedValue, after: a.eliteCohesion.estimatedValue },
      { k: "Military loyalty", before: b.militaryLoyalty.estimatedValue, after: a.militaryLoyalty.estimatedValue },
      { k: "Unrest", before: b.unrestLevel.estimatedValue, after: a.unrestLevel.estimatedValue },
      { k: "Sovereignty", before: b.sovereigntyIntegrity.estimatedValue, after: a.sovereigntyIntegrity.estimatedValue },
      { k: "Credibility", before: b.internationalCredibility.estimatedValue, after: a.internationalCredibility.estimatedValue },
      { k: "Economic stability", before: b.economicStability.estimatedValue, after: a.economicStability.estimatedValue },
      { k: "Inflation", before: b.inflationPressure.estimatedValue, after: a.inflationPressure.estimatedValue },
      { k: "War status", before: b.warStatus.estimatedValue, after: a.warStatus.estimatedValue },
      { k: "Intel clarity", before: b.intelligenceClarity.estimatedValue, after: a.intelligenceClarity.estimatedValue },
    ]
      .map((r) => ({ ...r, delta: r.after - r.before }))
      .filter((r) => r.delta !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 8);
    return rows;
  }, [beforeSnapshot, outcome]);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setBaseErr(null);
    setEnhancing(false);
    setEnhanceErr(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!outcome) return;
    // Fetch the base report quickly (translated ops, etc). Fast-mode server returns immediately.
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    apiResolutionReport(gameId, outcome.turnResolved, { signal: ac.signal })
      .then((r) => setReport(r as ResolutionReport))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setBaseErr((e as Error).message);
      })
      .finally(() => clearTimeout(t));
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, gameId, outcome]);

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

  const headline =
    report?.llm && typeof report.llm === "object" && "headline" in report.llm && typeof report.llm.headline === "string"
      ? report.llm.headline
      : `Turn ${outcome.turnResolved} — After Action`;

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4"
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
        {baseErr ? <div className="mt-2 text-xs font-mono text-red-300">Report: {baseErr}</div> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/50">Directive</div>
            <div className="mt-2 text-sm text-white/85 whitespace-pre-wrap">
              {shownDirective ? shownDirective : "(no directive submitted)"}
            </div>
            {report?.translatedActions?.length ? (
              <div className="mt-3">
                <div className="text-xs font-mono uppercase tracking-wider text-white/50">Operations executed</div>
                <ul className="mt-2 space-y-1 text-[12px] text-white/80">
                  {report.translatedActions.slice(0, 4).map((a) => (
                    <li key={a.summary}>- {a.summary}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {statChanges.length ? (
              <div className="mt-3">
                <div className="text-xs font-mono uppercase tracking-wider text-white/50">Stat changes</div>
                <div className="mt-2 space-y-1 text-[12px] text-white/80">
                  {statChanges.map((d) => (
                    <div key={d.k} className="flex items-center justify-between gap-3">
                      <span className="text-white/70">{d.k}</span>
                      <span className="tabular-nums">
                        {d.before} → {d.after}{" "}
                        <span className={d.delta >= 0 ? "text-emerald-300" : "text-red-300"}>
                          ({d.delta >= 0 ? "+" : ""}
                          {d.delta})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-white/50 font-mono">
                (No visible stat change this turn — try a higher-intensity directive or a different action category.)
              </div>
            )}
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

