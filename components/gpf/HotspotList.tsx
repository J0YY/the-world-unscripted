"use client";

import type { MapMode, UiHotspot } from "./types";
import { mapModeConfig } from "./types";

interface HotspotListProps {
  mode: MapMode;
  hotspots: UiHotspot[];
}

function TrendIndicator({ trend }: { trend: UiHotspot["trend"] }) {
  if (trend === "up") return <span className="text-red-500">▲</span>;
  if (trend === "down") return <span className="text-green-500">▼</span>;
  return <span className="text-[var(--ds-gray-500)]">—</span>;
}

export default function HotspotList({ mode, hotspots }: HotspotListProps) {
  const config = mapModeConfig[mode];

  return (
    <div className="space-y-3">
      <h2 className="my-0 font-mono font-medium text-xs tracking-tight uppercase text-[var(--ds-gray-900)]">
        {config.hotspotLabel}
      </h2>
      <ul className="list-none pl-0 space-y-1.5">
        {hotspots.slice(0, 5).map((hotspot, index) => (
          <li key={hotspot.id} className="flex items-center justify-between gap-2 text-sm font-mono">
            <div className="flex items-center gap-2">
              <span className="text-xs opacity-50">{index + 1}.</span>
              <span className="inline-block w-2 h-2" style={{ backgroundColor: hotspot.color }} aria-hidden="true" />
              <span className="text-[var(--ds-gray-1000)]">{hotspot.region}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-[var(--ds-gray-900)]">{hotspot.value}</span>
              <TrendIndicator trend={hotspot.trend} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

