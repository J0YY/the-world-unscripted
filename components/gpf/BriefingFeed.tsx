"use client";

import { AnimatePresence, motion } from "framer-motion";
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
        <AnimatePresence initial={false}>
          {briefings.map((briefing, idx) => (
            <motion.div
              key={briefing.id}
              initial={{ opacity: 0, y: 10, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: "easeOut", delay: Math.min(idx * 0.1, 0.9) }}
              className="relative overflow-hidden p-2 bg-[var(--ds-background-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono"
            >
              {/* Transmission reveal: wipe + noise (cosmetic) */}
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                initial={{ opacity: 0.22 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 2px, transparent 5px)",
                  mixBlendMode: "overlay",
                }}
              />
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 -left-[30%] w-[160%]"
                initial={{ x: "-55%", opacity: 0.55 }}
                animate={{ x: "55%", opacity: 0 }}
                transition={{ duration: 0.55, ease: "easeInOut" }}
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.0), rgba(255,255,255,0.14), rgba(255,255,255,0.0))",
                  mixBlendMode: "overlay",
                }}
              />
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
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

