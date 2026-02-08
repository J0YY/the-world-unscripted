"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import type { TurnOutcome } from "@/engine";
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
  llmPending?: boolean;
  llmError?: string;
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
  directiveText,
  llmMode,
  onClose,
}: {
  open: boolean;
  gameId: string;
  outcome: TurnOutcome | null;
  directiveText: string;
  llmMode?: "ON" | "OFF";
  onClose: () => void;
}) {
  const router = useRouter();
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [baseErr, setBaseErr] = useState<string | null>(null);
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
    return lines;
  }, [shownDirective]);

  const narrative = useMemo(() => {
    if (!outcome) return [];
    if (report?.llm && typeof report.llm === "object" && Array.isArray(report.llm.narrative)) {
      const llmLines = report.llm.narrative.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
      // Only trust the LLM narrative if it has substance; otherwise fall back to deterministic.
      if (llmLines.length >= 2) return [...openingLines, ...llmLines].slice(0, 18);
    }
    // When AI is ON, do not show the deterministic "field brief" while waiting —
    // unless we have a concrete AI error, in which case we fall back so the modal isn't blank.
    const llmErr = typeof report?.llmError === "string" ? report.llmError.trim() : "";
    if (llmMode === "ON" && !llmErr) return [...openingLines, "(Generating report…)"];
    // Deterministic fallback: still "dynamic" per-turn because it's synthesized from
    // the executed actions + true deltas + consequences, not a static template block.
    const lines: string[] = [...openingLines];
    if (llmErr) lines.push(`(AI error: ${llmErr})`);
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

    // If AI is explicitly OFF, surface that clearly.
    if (llmMode === "OFF") lines.push("(AI offline: showing deterministic brief.)");

    const out = lines.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).slice(0, 18);
    return out.length ? out : ["(Generating report…)"];
  }, [outcome, report, openingLines, llmMode]);

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
  }, [report]);

  const statChanges = useMemo(() => {
    // Prefer server-side "ground truth" deltas (derived from WorldState before/after).
    // Player-facing observed indicators are intentionally noisy (intel fog), and can swing
    // even when the underlying true stat barely moved.
    const rows = Array.isArray(report?.deltas) ? report!.deltas : [];
    return rows
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 8);
  }, [report]);

  // Hard deadline: after this many ms, stop waiting for AI and show whatever we have.
  const AI_DEADLINE_MS = 20_000;
  const [aiTimedOut, setAiTimedOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!outcome) return;
    const ac = new AbortController();
    const wantAi = llmMode === "ON";
    let cancelled = false;
    setAiTimedOut(false);
    const startedAt = Date.now();

    const deadlineTimer = wantAi
      ? setTimeout(() => { if (!cancelled) setAiTimedOut(true); }, AI_DEADLINE_MS)
      : undefined;

    const fetchReport = async (opts?: { forceLlm?: boolean; waitMs?: number }) => {
      try {
        return (await apiResolutionReport(gameId, outcome.turnResolved, {
          signal: ac.signal,
          forceLlm: opts?.forceLlm,
          waitMs: opts?.waitMs,
        })) as ResolutionReport;
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
        throw e;
      }
    };

    const hasNarrative = (r: ResolutionReport | null) => {
      if (!r?.llm) return false;
      const lines = Array.isArray((r.llm as Record<string,unknown>).narrative)
        ? ((r.llm as Record<string,unknown>).narrative as string[]).filter((s) => typeof s === "string" && s.trim()).length
        : 0;
      return lines >= 2;
    };

    void (async () => {
      try {
        // First fetch — kick off generation, wait up to 8s server-side.
        const first = await fetchReport({ forceLlm: wantAi, waitMs: wantAi ? 8_000 : 0 });
        if (cancelled || !first) return;
        setReport(first);

        if (!wantAi || hasNarrative(first)) return;
        const err1 = typeof first.llmError === "string" ? first.llmError.trim() : "";
        if (err1) return;

        // Poll every 4s until narrative arrives or deadline expires.
        const POLL_INTERVAL = 4_000;
        while (!cancelled && Date.now() - startedAt < AI_DEADLINE_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          if (cancelled) return;
          const next = await fetchReport({ waitMs: 4_000 });
          if (cancelled || !next) return;
          setReport(next);
          if (hasNarrative(next)) return;
          const errN = typeof next.llmError === "string" ? next.llmError.trim() : "";
          if (errN) return;
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (!cancelled) setBaseErr((e as Error).message);
      }
    })();

    return () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      cancelled = true;
      ac.abort();
    };
  }, [open, gameId, outcome?.turnResolved, llmMode]);

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
    const t = setTimeout(() => void resetToLanding(), 0);
    return () => clearTimeout(t);
  }, [open, outcome, report, autoGameOver, resetting, resetToLanding]);

  if (!open || !outcome) return null;

  const headline =
    report?.llm && typeof report.llm === "object" && "headline" in report.llm && typeof report.llm.headline === "string"
      ? report.llm.headline
      : `Turn ${outcome.turnResolved} — After Action`;

  const aiReady =
    llmMode !== "ON" ||
    aiTimedOut ||
    (!!report?.llm && Array.isArray((report.llm as Record<string,unknown>).narrative) && ((report.llm as Record<string,unknown>).narrative as unknown[]).filter((x) => typeof x === "string").length >= 2);

  const loadingAi = llmMode === "ON" && !aiReady && !baseErr;
  const stamp = useMemo(() => {
    const err = typeof report?.llmError === "string" && report.llmError.trim() ? report.llmError.trim() : "";
    const contested = llmMode === "ON" && (!aiReady || !!err || !!baseErr);
    return {
      text: contested ? "CONTESTED" : "CONFIRMED",
      tone: contested ? "contested" as const : "confirmed" as const,
    };
  }, [aiReady, baseErr, llmMode, report?.llmError]);

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
        className="relative w-full max-w-4xl max-h-[84vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        {/* Classified stamp (cosmetic) */}
        <motion.div
          key={`${outcome.turnResolved}-${stamp.text}`}
          className={[
            "pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rotate-[-14deg] select-none",
            "border rounded px-6 py-2",
            stamp.tone === "confirmed" ? "border-emerald-500/35 text-emerald-200/25" : "border-amber-500/35 text-amber-200/25",
          ].join(" ")}
          initial={{ opacity: 0, scale: 1.35, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          style={{ textShadow: "0 0 18px rgba(255,255,255,0.06)" }}
          aria-hidden="true"
        >
          <div className="font-mono font-black tracking-[0.45em] text-4xl leading-none">{stamp.text}</div>
        </motion.div>

        {llmMode === "ON" && !aiReady ? (
          <div className="rounded-xl border border-white/10 bg-black/30 p-6">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/50">After Action</div>
            <div className="mt-3 text-2xl font-semibold text-white">Generating brief</div>
            <div className="mt-2 text-sm text-white/70">
              Compiling the end-of-turn intelligence memo. This blocks until the narrative is ready.
            </div>
            <ul className="mt-5 space-y-2 text-sm text-white/80 font-mono">
              {[
                "Reconciling events and consequences…",
                "Synthesizing chain-of-events…",
                "Projecting second-order impacts…",
                "Formatting timeline blocks…",
              ].map((t) => (
                <li key={t}>- {t}</li>
              ))}
            </ul>
            <div className="mt-6 h-1 w-full bg-white/10 rounded overflow-hidden">
              <div className="h-full w-1/3 bg-white/60 animate-pulse" />
            </div>
            {loadingAi ? <div className="mt-3 text-xs font-mono text-white/50">Waiting for AI…</div> : null}
            {baseErr ? <div className="mt-4 text-xs font-mono text-red-300">Report: {baseErr}</div> : null}
            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => { setAiTimedOut(true); }}
                className="rounded border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-white/80 hover:bg-white/10"
              >
                {baseErr ? "Continue anyway" : "Skip — show results"}
              </button>
            </div>
          </div>
        ) : (
          <>
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

        {baseErr ? <div className="mt-2 text-xs font-mono text-red-300">Report: {baseErr}</div> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-white/50">Directive</div>
            <div className="mt-2 text-sm text-white/85 whitespace-pre-wrap">
              {shownDirective ? shownDirective : "(no directive submitted)"}
            </div>
            {report?.translatedActions?.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer select-none text-xs font-mono uppercase tracking-wider text-white/50 hover:text-white/70">
                  Technical log
                </summary>
                <div className="mt-2 rounded border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/50">Internal actions</div>
                  <ul className="mt-2 space-y-1 text-[12px] text-white/80">
                    {report.translatedActions.slice(0, 4).map((a) => (
                      <li key={a.summary}>- {a.summary}</li>
                    ))}
                  </ul>
                </div>
              </details>
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
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

