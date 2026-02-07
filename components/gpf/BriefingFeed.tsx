"use client";

import type { UiBriefingItem } from "./types";

const sourceColors: Record<UiBriefingItem["source"], string> = {
  Intercept: "#dc2626",
  "Foreign Desk": "#3b82f6",
  Markets: "#22c55e",
  "Embassy Cable": "#f59e0b",
};

export default function BriefingFeed({ briefings }: { briefings: UiBriefingItem[] }) {
  return (
    <div className="h-full flex flex-col bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded">
      <div className="px-3 py-2 border-b border-[var(--ds-gray-alpha-200)]">
        <h2 className="my-0 font-mono font-medium text-xs tracking-tight uppercase text-[var(--ds-gray-900)]">
          BRIEFING (INCOMPLETE)
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[400px] lg:max-h-none">
        {briefings.length === 0 ? (
          <div className="p-2 bg-[var(--ds-background-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono text-[var(--ds-gray-700)]">
            Generating briefing feed…
          </div>
        ) : null}
        {briefings.map((briefing) => (
          <div
            key={briefing.id}
            className="p-2 bg-[var(--ds-background-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[var(--ds-gray-500)]">{briefing.timestamp}</span>
              <span
                className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide"
                style={{
                  backgroundColor: `${sourceColors[briefing.source]}20`,
                  color: sourceColors[briefing.source],
                }}
              >
                {briefing.source}
              </span>
            </div>
            <p className="m-0 text-[var(--ds-gray-1000)] leading-relaxed">{briefing.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

