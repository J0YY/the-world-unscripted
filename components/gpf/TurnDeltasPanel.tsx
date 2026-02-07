"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameSnapshot } from "@/engine";
import { apiResolutionReport } from "@/components/api";

type ResolutionReportLite = {
  deltas?: Array<{ label: string; before: number; after: number; delta: number }>;
};

function isBadWhenHigh(label: string) {
  const k = label.trim().toLowerCase();
  return k === "unrest" || k === "inflation pressure" || k === "debt stress";
}

function deltaClass(label: string, delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return "text-[var(--ds-gray-700)]";
  const good = isBadWhenHigh(label) ? delta < 0 : delta > 0;
  return good ? "text-green-600" : "text-red-600";
}

export default function TurnDeltasPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const [rows, setRows] = useState<Array<{ label: string; before: number; after: number; delta: number }> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const turnResolved = snapshot.turn - 1;

  useEffect(() => {
    if (turnResolved < 1) {
      setRows([]);
      setErr(null);
      return;
    }
    const ac = new AbortController();
    setErr(null);
    setRows(null);
    apiResolutionReport(snapshot.gameId, turnResolved, { signal: ac.signal })
      .then((r) => {
        const rep = r as ResolutionReportLite;
        const deltas = Array.isArray(rep?.deltas) ? rep.deltas : [];
        setRows(
          deltas
            .filter((d) => d && typeof d.label === "string" && Number.isFinite(d.before) && Number.isFinite(d.after) && Number.isFinite(d.delta))
            .map((d) => ({ label: d.label, before: d.before, after: d.after, delta: d.delta })),
        );
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setErr((e as Error).message);
        setRows([]);
      });
    return () => ac.abort();
  }, [snapshot.gameId, turnResolved]);

  const ordered = useMemo(() => {
    const list = rows ?? [];
    const want = [
      "Economic stability",
      "Unrest",
      "Legitimacy",
      "Inflation pressure",
      "Debt stress",
      "Sovereignty integrity",
      "Global credibility",
    ];
    const by = new Map(list.map((d) => [d.label, d]));
    const picked = want.map((k) => by.get(k)).filter(Boolean) as typeof list;
    return picked.length ? picked : list.slice(0, 7);
  }, [rows]);

  return (
    <div className="space-y-3">
      <h2 className="my-0 font-mono font-medium text-xs tracking-tight uppercase text-[var(--ds-gray-900)]">
        Turn deltas
      </h2>
      {err ? <div className="text-xs font-mono text-[var(--ds-red-700)]">Deltas error: {err}</div> : null}
      {!rows ? (
        <div className="text-xs font-mono text-[var(--ds-gray-700)]">Loading…</div>
      ) : ordered.length === 0 ? (
        <div className="text-xs font-mono text-[var(--ds-gray-700)]">No deltas recorded yet.</div>
      ) : (
        <ul className="list-none pl-0 space-y-1.5">
          {ordered.map((d) => (
            <li key={d.label} className="flex items-center justify-between gap-2 text-sm font-mono">
              <span className="text-[var(--ds-gray-1000)]">{d.label}</span>
              <span className="tabular-nums text-[var(--ds-gray-900)]">
                {d.before} → {d.after}{" "}
                <span className={deltaClass(d.label, d.delta)}>
                  ({d.delta >= 0 ? "+" : ""}
                  {d.delta})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

