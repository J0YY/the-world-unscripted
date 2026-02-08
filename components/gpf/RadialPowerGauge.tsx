"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";

/* ---------- SVG arc helper ---------- */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

/* ---------- Tick marks ---------- */
function Ticks({ cx, cy, r, count }: { cx: number; cy: number; r: number; count: number }) {
  const ticks = [];
  const sweepStart = -120;
  const sweepEnd = 120;
  for (let i = 0; i <= count; i++) {
    const angle = sweepStart + (i / count) * (sweepEnd - sweepStart);
    const inner = polarToCartesian(cx, cy, r - 6, angle);
    const isMajor = i % 5 === 0;
    const outer = polarToCartesian(cx, cy, r - (isMajor ? 0 : 3), angle);
    ticks.push(
      <line
        key={i}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke="var(--ds-gray-alpha-400)"
        strokeWidth={isMajor ? 1.2 : 0.6}
        strokeLinecap="round"
      />,
    );
  }
  return <g>{ticks}</g>;
}

/* ---------- Main component ---------- */
export default function RadialPowerGauge({
  powerIndex,
  powerBreakdown,
  pressureIndex,
  narrativeGravity,
  systemStrain,
}: {
  powerIndex: number;
  powerBreakdown?: {
    economicStability: number;
    legitimacy: number;
    internationalCredibility: number;
    influence: number;
    mix: { domestic: number; influence: number };
  };
  pressureIndex: number;
  narrativeGravity: number;
  systemStrain: number;
}) {
  const prevPowerRef = useRef(powerIndex);
  const [hit, setHit] = useState<null | "up" | "down">(null);

  useEffect(() => {
    const prev = prevPowerRef.current;
    if (!Number.isFinite(prev) || prev === powerIndex) return;
    prevPowerRef.current = powerIndex;
    setHit(powerIndex > prev ? "up" : "down");
    const t = setTimeout(() => setHit(null), 900);
    return () => clearTimeout(t);
  }, [powerIndex]);

  /* Layout constants */
  const cx = 120;
  const cy = 110;
  const r = 85;
  const sweepStart = -120;
  const sweepEnd = 120;
  const clampedPower = Math.max(0, Math.min(100, powerIndex));
  const needleAngle = sweepStart + (clampedPower / 100) * (sweepEnd - sweepStart);

  /* Color logic */
  const color =
    clampedPower >= 70
      ? { fill: "#10b981", glow: "rgba(16,185,129,0.5)", text: "text-emerald-500" }
      : clampedPower >= 45
        ? { fill: "#eab308", glow: "rgba(234,179,8,0.4)", text: "text-amber-500" }
        : { fill: "#ef4444", glow: "rgba(239,68,68,0.5)", text: "text-red-500" };

  const pressureColor =
    pressureIndex >= 75 ? "text-red-500" : pressureIndex >= 50 ? "text-amber-500" : "text-green-500";
  const pressureBar =
    pressureIndex >= 75 ? "bg-red-500" : pressureIndex >= 50 ? "bg-amber-500" : "bg-green-500";

  /* Background gradient arc (red→amber→green) */
  const bgGradientId = "gauge-gradient";

  /* Needle endpoint */
  const needleTip = polarToCartesian(cx, cy, r - 12, needleAngle);
  const needleBase1 = polarToCartesian(cx, cy, 4, needleAngle - 90);
  const needleBase2 = polarToCartesian(cx, cy, 4, needleAngle + 90);

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
      {/* Header */}
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
                Mix: {Math.round(powerBreakdown.mix.domestic * 100)}% domestic +{" "}
                {Math.round(powerBreakdown.mix.influence * 100)}% influence.
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Radial gauge */}
      <div className="relative flex justify-center">
        <svg viewBox="0 0 240 155" className="w-full max-w-[240px]">
          <defs>
            <linearGradient id={bgGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="40%" stopColor="#eab308" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
            </linearGradient>
            <filter id="needle-glow">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
          </defs>

          {/* Background arc */}
          <path
            d={describeArc(cx, cy, r, sweepStart, sweepEnd)}
            fill="none"
            stroke={`url(#${bgGradientId})`}
            strokeWidth={10}
            strokeLinecap="round"
          />

          {/* Ticks */}
          <Ticks cx={cx} cy={cy} r={r} count={20} />

          {/* Value arc (filled portion) */}
          {clampedPower > 0 && (
            <motion.path
              d={describeArc(cx, cy, r, sweepStart, needleAngle)}
              fill="none"
              stroke={color.fill}
              strokeWidth={10}
              strokeLinecap="round"
              initial={false}
              animate={{
                opacity: hit === "up" ? [0.6, 1, 0.85, 1] : 1,
                filter: hit === "up"
                  ? [`drop-shadow(0 0 8px ${color.glow})`, `drop-shadow(0 0 16px ${color.glow})`, `drop-shadow(0 0 8px ${color.glow})`]
                  : `drop-shadow(0 0 6px ${color.glow})`,
              }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          )}

          {/* Needle glow (behind) */}
          <polygon
            points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
            fill={color.fill}
            opacity={0.3}
            filter="url(#needle-glow)"
          />

          {/* Needle */}
          <motion.polygon
            points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
            fill={color.fill}
            initial={false}
            animate={{
              opacity: hit === "down" ? [1, 0.5, 1] : 1,
            }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />

          {/* Center dot */}
          <circle cx={cx} cy={cy} r={5} fill="var(--ds-gray-alpha-400)" />
          <circle cx={cx} cy={cy} r={3} fill={color.fill} />

          {/* Value text */}
          <motion.text
            x={cx}
            y={cy + 32}
            textAnchor="middle"
            className={`text-3xl font-mono font-bold tabular-nums ${color.text}`}
            fill="currentColor"
            initial={false}
            animate={
              hit === "up"
                ? {
                    scale: [1, 1.08, 1],
                  }
                : hit === "down"
                  ? { scale: [1, 0.96, 1] }
                  : { scale: 1 }
            }
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            {powerIndex}%
          </motion.text>

          {/* Labels at ends */}
          <text
            x={polarToCartesian(cx, cy, r + 12, sweepStart).x}
            y={polarToCartesian(cx, cy, r + 12, sweepStart).y}
            textAnchor="middle"
            fontSize="8"
            fill="var(--ds-gray-600)"
            fontFamily="monospace"
          >
            0
          </text>
          <text
            x={polarToCartesian(cx, cy, r + 12, sweepEnd).x}
            y={polarToCartesian(cx, cy, r + 12, sweepEnd).y}
            textAnchor="middle"
            fontSize="8"
            fill="var(--ds-gray-600)"
            fontFamily="monospace"
          >
            100
          </text>
        </svg>

        {/* Impact flash */}
        <AnimatePresence>
          {hit === "down" ? (
            <motion.div
              key="gauge-hit"
              className="absolute inset-0 pointer-events-none rounded"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                background: "radial-gradient(ellipse at center, rgba(239,68,68,0.2), transparent 70%)",
              }}
            />
          ) : hit === "up" ? (
            <motion.div
              key="gauge-up"
              className="absolute inset-0 pointer-events-none rounded"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.15, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                background: "radial-gradient(ellipse at center, rgba(16,185,129,0.2), transparent 70%)",
              }}
            />
          ) : null}
        </AnimatePresence>
      </div>

      {/* Sub-metrics (unchanged layout) */}
      <div className="pt-2 border-t border-[var(--ds-gray-alpha-200)] space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-sm font-mono tabular-nums">
          <span className="text-[var(--ds-gray-700)] uppercase">World pressure</span>
          <span className={pressureColor}>{pressureIndex}%</span>
        </div>
        <div className="w-full h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
          <div className={`h-full rounded-sm transition-all ${pressureBar}`} style={{ width: `${pressureIndex}%` }} />
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
