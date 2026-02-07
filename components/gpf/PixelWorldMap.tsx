"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { geoMercator } from "d3-geo";
import { mapModeConfig, type MapMode, type CountryColorMap } from "./types";

type DottedMapData = Record<string, Array<{ lon: number; lat: number; cityDistanceRank: number }>>;

const modeColors: Record<MapMode, { high: string; med: string; low: string }> = {
  pressure: { high: "#dc2626", med: "#f97316", low: "#3b82f6" },
  relationship: { high: "#dc2626", med: "#eab308", low: "#22c55e" },
  "world-events": { high: "#ffffff", med: "#ffffff", low: "#ffffff" },
};

const ColoredPixel = memo(
  ({ x, y, color }: { x: number; y: number; color: string }) => (
    <rect x={x} y={y} width={2.5} height={2.5} fill={color} opacity={0.9} />
  )
);
ColoredPixel.displayName = "ColoredPixel";

const UncoloredPixel = memo(({ x, y }: { x: number; y: number }) => (
  <rect x={x} y={y} width={2.5} height={2.5} fill="rgba(255, 255, 255, 0.3)" />
));
UncoloredPixel.displayName = "UncoloredPixel";

interface PixelWorldMapProps {
  width?: number;
  height?: number;
  mode: MapMode;
  countryColors: CountryColorMap[];
}

export default function PixelWorldMap({
  width = 1000,
  height = 560,
  mode,
  countryColors,
}: PixelWorldMapProps) {
  const [dottedMapData, setDottedMapData] = useState<DottedMapData | null>(null);
  const [dottedMapErr, setDottedMapErr] = useState<string | null>(null);

  const projection = useMemo(
    () =>
      geoMercator()
        .scale(140)
        .center([15, 25])
        .rotate([0, 0, 0])
        .translate([width / 2, height / 2]),
    [width, height],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ui/dotted-map");
        const json = (await res.json()) as { data?: unknown; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Failed to load dotted map (${res.status})`);
        if (!cancelled) setDottedMapData(json.data as DottedMapData);
      } catch (e) {
        if (!cancelled) setDottedMapErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build map of country code to color
  const countryColorMap = useMemo(() => {
    const map = new Map<string, { color: string; intensity: "high" | "med" | "low" | "uncolored" }>();
    countryColors.forEach((cc) => {
      map.set(cc.countryCode, { color: cc.color || "#999999", intensity: cc.intensity });
    });
    return map;
  }, [countryColors]);

  const pixels = useMemo(() => {
    const result: Array<{
      key: string;
      x: number;
      y: number;
      color: string;
      countryCode: string;
      isColored: boolean;
    }> = [];

    if (!dottedMapData) return result;

    Object.entries(dottedMapData).forEach(([countryCode, cities]) => {
      const colorInfo = countryColorMap.get(countryCode);
      const isColored = colorInfo != null && colorInfo.intensity !== "uncolored";
      const color = colorInfo?.color || "rgba(255, 255, 255, 0.3)";

      cities.forEach((city) => {
        const coords = projection([city.lon, city.lat]);
        if (!coords) return;

        const [x, y] = coords;
        if (x < 0 || x > width || y < 0 || y > height) return;

        result.push({
          key: `${countryCode}-${city.cityDistanceRank}`,
          x,
          y,
          color,
          countryCode,
          isColored,
        });
      });
    });

    return result;
  }, [dottedMapData, projection, width, height, countryColorMap]);

  const config = mapModeConfig[mode];
  const colors = modeColors[mode];

  return (
    <div className="relative w-full">
      {dottedMapErr ? (
        <div className="absolute top-2 left-2 z-10 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 px-2 py-1 text-[10px] font-mono text-[var(--ds-red-700)]">
          Map dataset missing: {dottedMapErr}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-[var(--ds-background-100)]">
        <g>
          {pixels.map((p) =>
            p.isColored ? (
              <ColoredPixel key={p.key} x={p.x} y={p.y} color={p.color} />
            ) : (
              <UncoloredPixel key={p.key} x={p.x} y={p.y} />
            )
          )}
        </g>
      </svg>

      <div className="absolute bottom-2 left-2 p-2 bg-[var(--ds-background-100)]/80 backdrop-blur-sm border border-[var(--ds-gray-alpha-400)] rounded text-[10px] font-mono">
        <div className="text-[var(--ds-gray-900)] uppercase mb-1.5">{config.legendLabel}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.high }} />
            <span className="text-[var(--ds-gray-900)]">High</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.med }} />
            <span className="text-[var(--ds-gray-900)]">Med</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.low }} />
            <span className="text-[var(--ds-gray-900)]">Low</span>
          </div>
        </div>
      </div>
    </div>
  );
}

