"use client";

import type { UiSignal } from "./types";

function ConfidenceGlyph({ confidence }: { confidence: UiSignal["confidence"] }) {
  const filled = confidence === "HIGH" ? 3 : confidence === "MED" ? 2 : 1;
  return (
    <span className="text-[10px] tracking-wider opacity-60">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={i < filled ? "text-[var(--ds-gray-1000)]" : "text-[var(--ds-gray-400)]"}>
          ●
        </span>
      ))}
    </span>
  );
}

function IntensityBar({ intensity }: { intensity: number }) {
  const width = Math.round(clamp(intensity, 0, 1) * 100);
  const color = intensity > 0.7 ? "#dc2626" : intensity > 0.4 ? "#f59e0b" : "#22c55e";

  return (
    <div className="w-8 h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
      <div className="h-full rounded-sm transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  );
}

export default function SignalsStrip({ signals }: { signals: UiSignal[] }) {
  return (
    <div className="w-full border-t border-[var(--ds-gray-alpha-200)] pt-3 mt-4">
      <div className="flex flex-wrap gap-2 justify-center md:justify-start">
        {signals.map((signal) => (
          <div
            key={signal.id}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono"
          >
            <span className="text-[var(--ds-gray-1000)] whitespace-nowrap">{signal.label}</span>
            <IntensityBar intensity={signal.intensity} />
            <ConfidenceGlyph confidence={signal.confidence} />
          </div>
        ))}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

