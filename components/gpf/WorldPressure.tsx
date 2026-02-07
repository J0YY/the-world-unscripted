"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export default function WorldPressure({
  pressureIndex,
  powerIndex,
  powerBreakdown,
  narrativeGravity,
  systemStrain,
}: {
  pressureIndex: number;
  powerIndex: number;
  powerBreakdown?: {
    economicStability: number;
    legitimacy: number;
    internationalCredibility: number;
    influence: number;
    mix: { domestic: number; influence: number };
  };
  narrativeGravity: number;
  systemStrain: number;
}) {
  const pressureText =
    pressureIndex >= 75 ? "text-red-500" : pressureIndex >= 50 ? "text-amber-500" : "text-green-500";
  const pressureBar =
    pressureIndex >= 75 ? "bg-red-500" : pressureIndex >= 50 ? "bg-amber-500" : "bg-green-500";
  // Power is GOOD when high.
  const powerText = powerIndex >= 70 ? "text-emerald-500" : powerIndex >= 45 ? "text-amber-500" : "text-red-500";
  const powerBar = powerIndex >= 70 ? "bg-emerald-500" : powerIndex >= 45 ? "bg-amber-500" : "bg-red-500";

  const prevPowerRef = useRef<number>(powerIndex);
  const [hit, setHit] = useState<null | "up" | "down">(null);

  useEffect(() => {
    const prev = prevPowerRef.current;
    if (!Number.isFinite(prev) || prev === powerIndex) return;
    const delta = powerIndex - prev;
    prevPowerRef.current = powerIndex;
    setHit(delta >= 0 ? "up" : "down");
    const t = setTimeout(() => setHit(null), 720);
    return () => clearTimeout(t);
  }, [powerIndex]);

  const powerWidth = useMemo(() => Math.max(0, Math.min(100, powerIndex)), [powerIndex]);
  const powerOvershoot = useMemo(() => Math.max(0, Math.min(100, powerIndex + 6)), [powerIndex]);

  return (
    <motion.div
      className="space-y-4"
      initial={false}
      animate={
        hit === "down"
          ? { x: [0, -2, 2, -1, 1, 0], filter: ["saturate(0.85)", "saturate(0.8)", "saturate(0.85)"] }
          : { x: 0, filter: "saturate(1)" }
      }
      transition={{ duration: hit === "down" ? 0.35 : 0.2, ease: "easeOut" }}
    >
      <div className="relative space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="my-0 font-mono font-medium text-xs tracking-tight uppercase text-[var(--ds-gray-900)]">
            POWER
          </h2>
          {powerBreakdown ? (
            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-1 text-[var(--ds-gray-900)] hover:bg-[var(--ds-gray-alpha-200)] transition"
                aria-label="Power breakdown"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-[320px] max-w-[80vw] rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3 text-xs text-[var(--ds-gray-900)] shadow-xl group-hover:block group-focus-within:block">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">
                  Power breakdown
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 font-mono tabular-nums">
                  <div className="text-[var(--ds-gray-700)]">Economic stability</div>
                  <div className="text-right">{Math.round(powerBreakdown.economicStability)}%</div>
                  <div className="text-[var(--ds-gray-700)]">Legitimacy</div>
                  <div className="text-right">{Math.round(powerBreakdown.legitimacy)}%</div>
                  <div className="text-[var(--ds-gray-700)]">Credibility</div>
                  <div className="text-right">{Math.round(powerBreakdown.internationalCredibility)}%</div>
                  <div className="text-[var(--ds-gray-700)]">Influence</div>
                  <div className="text-right">{Math.round(powerBreakdown.influence)}%</div>
                </div>
                <div className="mt-2 text-[11px] text-[var(--ds-gray-700)] font-mono">
                  Mix: {Math.round(powerBreakdown.mix.domestic * 100)}% domestic + {Math.round(powerBreakdown.mix.influence * 100)}% influence.
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-baseline gap-1">
          <motion.span
            className={`text-4xl md:text-5xl tracking-normal font-mono tabular-nums ${powerText}`}
            initial={false}
            animate={
              hit === "up"
                ? { scale: [1, 1.06, 1], textShadow: ["0 0 0px rgba(16,185,129,0)", "0 0 18px rgba(16,185,129,0.35)", "0 0 0px rgba(16,185,129,0)"] }
                : hit === "down"
                  ? { scale: [1, 0.99, 1] }
                  : { scale: 1, textShadow: "0 0 0px rgba(0,0,0,0)" }
            }
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            {powerIndex}
          </motion.span>
          <span className="text-xl font-mono text-[var(--ds-gray-700)]">%</span>
        </div>
        <div className="w-full h-2 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
          <motion.div
            className={`h-full rounded-sm ${powerBar}`}
            initial={false}
            animate={{
              width: hit === "up" ? [`${powerOvershoot}%`, `${powerWidth}%`] : `${powerWidth}%`,
            }}
            transition={{ duration: hit === "up" ? 0.55 : 0.25, ease: "easeOut" }}
          />
        </div>
        <AnimatePresence>
          {hit === "down" ? (
            <motion.div
              key="power-crash"
              className="absolute left-0 right-0 h-10 -mt-10 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.18, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              style={{ background: "linear-gradient(180deg, rgba(239,68,68,0.0), rgba(239,68,68,0.18), rgba(239,68,68,0.0))" }}
            />
          ) : null}
        </AnimatePresence>
        <div className="pt-2 border-t border-[var(--ds-gray-alpha-200)] space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm font-mono tabular-nums">
            <span className="text-[var(--ds-gray-700)] uppercase">World pressure</span>
            <span className={pressureText}>{pressureIndex}%</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
            <div className={`h-full rounded-sm transition-all ${pressureBar}`} style={{ width: `${pressureIndex}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2 border-t border-[var(--ds-gray-alpha-200)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-[var(--ds-gray-900)]">Narrative Gravity</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
              <div className="h-full bg-blue-500 rounded-sm" style={{ width: `${narrativeGravity}%` }} />
            </div>
            <span className="text-xs font-mono tabular-nums text-[var(--ds-gray-1000)] w-8 text-right">
              {narrativeGravity}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-[var(--ds-gray-900)]">System Strain</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
              <div className="h-full bg-amber-500 rounded-sm" style={{ width: `${systemStrain}%` }} />
            </div>
            <span className="text-xs font-mono tabular-nums text-[var(--ds-gray-1000)] w-8 text-right">
              {systemStrain}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

