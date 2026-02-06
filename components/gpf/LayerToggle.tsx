"use client";

import { mapModeConfig, type MapMode } from "./types";

interface LayerToggleProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  intelFog: boolean;
  onIntelFogChange: (value: boolean) => void;
  showExposure: boolean;
  onShowExposureChange: (value: boolean) => void;
}

export default function LayerToggle({
  mode,
  onModeChange,
  intelFog,
  onIntelFogChange,
  showExposure,
  onShowExposureChange,
}: LayerToggleProps) {
  const modes: MapMode[] = ["relationship", "world-events"];

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-0.5 p-0.5 bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1 text-xs font-mono uppercase tracking-wide rounded transition-all cursor-pointer border-none ${
              mode === m
                ? "bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]"
                : "bg-transparent text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)]"
            }`}
            type="button"
          >
            {mapModeConfig[m].label}
          </button>
        ))}
      </div>

    </div>
  );
}

