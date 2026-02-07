"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import type { GameSnapshot, TurnOutcome } from "@/engine";
import { apiReset } from "@/components/api";
import { apiResolutionReport } from "@/components/api";
import { clearStoredGame } from "@/components/storage";

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

function isBadWhenHigh(label: string): boolean {
  const k = label.trim().toLowerCase();
  return k === "unrest" || k === "inflation pressure" || k === "debt stress";
}

function deltaClass(label: string, delta: number): string {
  if (!Number.isFinite(delta) || delta === 0) return "text-white/60";
  const good = isBadWhenHigh(label) ? delta < 0 : delta > 0;
  return good ? "text-emerald-300" : "text-red-300";
}

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
  const router = useRouter();
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceErr, setEnhanceErr] = useState<string | null>(null);
  const autoEnhancedKeyRef = useRef<string | null>(null);
  const [ackCritical, setAckCritical] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);

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
      const llmLines = report.llm.narrative.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
      // Only trust the LLM narrative if it has substance; otherwise fall back to deterministic.
      if (llmLines.length >= 2) return [...openingLines, ...llmLines].slice(0, 18);
    }
    // Deterministic fallback: still "dynamic" per-turn because it's synthesized from
    // the executed actions + true deltas + consequences, not a static template block.
    const lines: string[] = [...openingLines];
    const turn = outcome.turnResolved;
    lines.push(`TURN ${turn} // FIELD BRIEF`);

    const deltas = Array.isArray(report?.deltas) ? report!.deltas : [];
    const top = deltas
      .filter((d) => Number.isFinite(d.delta) && d.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
    if (top.length) {
      lines.push(`Scoreboard: ${top.map((d) => `${d.label} (${d.delta >= 0 ? "+" : ""}${d.delta})`).join(", ")}`);
    }

    const cons = Array.isArray(report?.consequences) ? report!.consequences : outcome.consequences;
    const seenCons = new Set<string>();
    for (const c of cons) {
      const k = typeof c === "string" ? c.trim() : "";
      if (!k) continue;
      if (seenCons.has(k)) continue;
      seenCons.add(k);
      lines.push(`- ${k}`);
      if (seenCons.size >= 6) break;
    }

    const unknowns = Array.isArray(report?.signalsUnknown) ? report!.signalsUnknown : outcome.signalsUnknown;
    if (unknowns.length) {
      lines.push("Uncertainties:");
      const seenU = new Set<string>();
      for (const u of unknowns) {
        const k = typeof u === "string" ? u.trim() : "";
        if (!k) continue;
        if (seenU.has(k)) continue;
        seenU.add(k);
        lines.push(`- ${k}`);
        if (seenU.size >= 3) break;
      }
    }

    // If AI is expected but unavailable, surface that clearly.
    if (llmMode !== "ON") {
      lines.push("(AI offline: showing deterministic brief.)");
    } else if (enhancing) {
      lines.push("(Generating AI brief…)");
    } else if (enhanceErr) {
      lines.push(`(AI brief unavailable: ${enhanceErr})`);
    }

    const out = lines.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).slice(0, 18);
    return out.length ? out : ["(Generating report…)"];
  }, [outcome, report?.llm, report?.deltas, report?.consequences, report?.signalsUnknown, openingLines, llmMode, enhancing, enhanceErr]);

  const criticalBreaches = useMemo(() => {
    const deltas = Array.isArray(report?.deltas) ? report!.deltas : [];
    const breaches: Array<{ label: string; after: number; kind: "floor" | "ceiling" }> = [];
    for (const d of deltas) {
      const label = d.label;
      const after = d.after;
      if (!Number.isFinite(after)) continue;
      if (isBadWhenHigh(label)) {
        if (after >= 100) breaches.push({ label, after, kind: "ceiling" });
      } else {
        if (after <= 0) breaches.push({ label, after, kind: "floor" });
      }
    }
    // Only warn on the extreme failure-style metrics the user cares about most.
    const allow = new Set(["Economic stability", "Unrest", "Inflation pressure", "Debt stress", "Sovereignty integrity", "Legitimacy"]);
    return breaches.filter((b) => allow.has(b.label));
  }, [report?.deltas]);

  const statChanges = useMemo(() => {
    // Prefer server-side "ground truth" deltas (derived from WorldState before/after).
    // Player-facing observed indicators are intentionally noisy (intel fog), and can swing
    // even when the underlying true stat barely moved.
    const rows = Array.isArray(report?.deltas) ? report!.deltas : [];
    return rows
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 8);
  }, [report?.deltas]);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setBaseErr(null);
    setEnhancing(false);
    setEnhanceErr(null);
    autoEnhancedKeyRef.current = null;
    setAckCritical(false);
    setResetting(false);
    setResetErr(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!outcome) return;
    // Fetch the base report quickly (translated ops, etc). Fast-mode server returns immediately.
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
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

  async function enhanceWithAi(opts?: { timeoutMs?: number }) {
    if (!outcome) return;
    if (llmMode !== "ON") return;
    setEnhancing(true);
    setEnhanceErr(null);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts?.timeoutMs ?? 45_000);
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

  useEffect(() => {
    // If AI is ON, auto-enhance the resolution by default (once per game+turn),
    // while still showing the fast deterministic report immediately.
    if (!open) return;
    if (llmMode !== "ON") return;
    if (!outcome) return;
    if (!report) return;
    // Only skip if we already have a usable LLM narrative.
    if (report.llm && typeof report.llm === "object" && Array.isArray((report.llm as { narrative?: unknown }).narrative)) return;
    if (enhancing) return;
    const key = `${gameId}:${outcome.turnResolved}`;
    if (autoEnhancedKeyRef.current === key) return;
    autoEnhancedKeyRef.current = key;
    void enhanceWithAi({ timeoutMs: 45_000 });
  }, [open, llmMode, outcome, report, enhancing, gameId]);

  const hasCritical = criticalBreaches.length > 0;
  const autoGameOver = criticalBreaches.length >= 2;

  const resetToLanding = useCallback(async () => {
    setResetting(true);
    setResetErr(null);
    try {
      await apiReset();
      clearStoredGame();
      onClose();
      router.push("/");
    } catch (e) {
      setResetErr((e as Error).message);
      setResetting(false);
    }
  }, [onClose, router]);

  // If multiple terminal thresholds are hit simultaneously, treat as immediate termination.
  useEffect(() => {
    if (!open) return;
    if (!outcome) return;
    if (!report) return;
    if (!autoGameOver) return;
    if (resetting) return;
    void resetToLanding();
  }, [open, outcome, report, autoGameOver, resetting, resetToLanding]);

  if (!open || !outcome) return null;

  const headline =
    report?.llm && typeof report.llm === "object" && "headline" in report.llm && typeof report.llm.headline === "string"
      ? report.llm.headline
      : `Turn ${outcome.turnResolved} — After Action`;

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/35 px-4 pt-12 pb-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        className="w-full max-w-4xl max-h-[84vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        {autoGameOver ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-red-200/70">Government terminated</div>
            <div className="mt-2 text-sm text-red-100">
              Multiple core metrics hit terminal thresholds in the same turn. The government falls.
            </div>
            <div className="mt-2 text-xs text-red-100/80 font-mono">
              {criticalBreaches.map((b) => `${b.label}: ${b.after}`).join(" · ")}
            </div>
            <div className="mt-3 text-xs font-mono text-red-200/70">
              {resetting ? "Resetting simulation and returning to start…" : "Resetting…"}
              {resetErr ? ` ERR: ${resetErr}` : ""}
            </div>
          </div>
        ) : null}

        {hasCritical && !autoGameOver && !ackCritical ? (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-amber-200/70">Critical warning</div>
            <div className="mt-2 text-sm text-amber-100">
              A core metric hit a terminal threshold. If another core metric hits a terminal threshold, your government falls.
            </div>
            <div className="mt-2 text-xs text-amber-100/80 font-mono">
              {criticalBreaches.map((b) => `${b.label}: ${b.after}`).join(" · ")}
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setAckCritical(true)}
                className="rounded border border-amber-500/30 bg-amber-950/10 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-amber-200 hover:bg-amber-950/20"
              >
                Understood
              </button>
            </div>
          </div>
        ) : null}

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
              onClick={() => {
                if (autoGameOver) return;
                if (hasCritical && !ackCritical) return;
                onClose();
              }}
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
                    <div key={d.label} className="flex items-center justify-between gap-3">
                      <span className="text-white/70">{d.label}</span>
                      <span className="tabular-nums">
                        {d.before} → {d.after}{" "}
                        <span className={deltaClass(d.label, d.delta)}>
                          ({d.delta >= 0 ? "+" : ""}
                          {d.delta})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : report ? (
              <div className="mt-3 text-[11px] text-white/50 font-mono">(No meaningful underlying stat delta recorded this turn.)</div>
            ) : (
              <div className="mt-3 text-[11px] text-white/50 font-mono">
                (Loading stat deltas…)
              </div>
            )}
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/50">Narrative</div>
            <ul className="mt-2 space-y-2">
              {narrative.map((line, idx) => (
                <li key={`${idx}-${line}`} className="text-sm text-white/85">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

