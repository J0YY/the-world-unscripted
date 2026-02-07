"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { geoMercator } from "d3-geo";
import { mapModeConfig, type MapMode, type CountryColorMap, type UiBriefingItem } from "./types";

type DottedMapData = Record<string, Array<{ lon: number; lat: number; cityDistanceRank: number }>>;

const modeColors: Record<MapMode, { high: string; med: string; low: string }> = {
  pressure: { high: "#dc2626", med: "#f97316", low: "#3b82f6" },
  relationship: { high: "#dc2626", med: "#eab308", low: "#22c55e" },
  "world-events": { high: "#ffffff", med: "#ffffff", low: "#ffffff" },
};

const ColoredPixel = memo(
  ({ x, y, color, onClick }: { x: number; y: number; color: string; onClick?: () => void }) => (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }} pointerEvents={onClick ? 'all' : 'none'}>
      {/* Larger invisible rect for easier clicking */}
      {onClick && (
        <rect 
          x={x - 1} 
          y={y - 1} 
          width={6} 
          height={6} 
          fill="transparent"
          pointerEvents="all"
        />
      )}
      {/* Visible pixel */}
      <rect 
        x={x} 
        y={y} 
        width={2.5} 
        height={2.5} 
        fill={color} 
        opacity={0.9}
        pointerEvents="none"
      />
    </g>
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
  briefings?: UiBriefingItem[];
  countryCodeToNames?: Map<string, Set<string>>;
}

export default function PixelWorldMap({
  width = 1000,
  height = 560,
  mode,
  countryColors,
  briefings = [],
  countryCodeToNames,
}: PixelWorldMapProps) {
  const [dottedMapData, setDottedMapData] = useState<DottedMapData | null>(null);
  const [dottedMapErr, setDottedMapErr] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

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

  // special marker inserted by adapters when player's country is fictional
  // (countryCode === "__PLAYER__"). Contains lat/lon of inferred location.
  const playerLocation = useMemo(() => countryColors.find((c) => c.countryCode === "__PLAYER__"), [countryColors]);

  // Filter briefings that mention the selected country
  const filteredBriefings = useMemo(() => {
    if (!selectedCountry || !countryCodeToNames) return [];
    
    const possibleNames = countryCodeToNames.get(selectedCountry);
    if (!possibleNames) return [];
    
    return briefings.filter((briefing) => {
      const content = briefing.content.toLowerCase();
      // Check if any of the country's possible names appear in the briefing
      for (const name of possibleNames) {
        if (content.includes(name)) {
          return true;
        }
      }
      return false;
    });
  }, [selectedCountry, briefings, countryCodeToNames]);

  const pixels = useMemo(() => {
    const result: Array<{
      key: string;
      x: number;
      y: number;
      color: string;
      countryCode: string;
      isColored: boolean;
      lon: number;
      lat: number;
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
          lon: city.lon,
          lat: city.lat,
        });
      });
    });

    // If mode is relationship and we have an inferred player location,
    // highlight nearby pixels in pink so the player's fictional country
    // is visible on the map. This overrides any other color for those pixels.
    if (mode === "relationship" && playerLocation) {
      const proj = projection([playerLocation.lon, playerLocation.lat]);
      if (proj) {
        const [px, py] = proj;
        const radius = 20; // pixels
        for (const p of result) {
          const dx = p.x - px;
          const dy = p.y - py;
          if (dx * dx + dy * dy <= radius * radius) {
            p.color = "#ffffff";
            p.isColored = true;
            p.countryCode = "__PLAYER__";
          }
        }
      }
    }

    return result;
  }, [dottedMapData, projection, width, height, countryColorMap, mode, playerLocation]);

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
                <ColoredPixel 
                  key={p.key} 
                  x={p.x} 
                  y={p.y} 
                  color={p.color}
                  onClick={mode === "world-events" ? () => setSelectedCountry(p.countryCode) : undefined}
                />
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

      {/* Briefings Panel - only in world-events mode */}
      {mode === "world-events" && selectedCountry && (
        <div 
          className="absolute top-4 right-4 z-50 w-96 max-w-[calc(100%-2rem)] p-4 bg-[var(--ds-background-100)]/95 backdrop-blur-sm border border-[var(--ds-gray-alpha-400)] rounded-lg shadow-xl"
          style={{
            maxHeight: '500px',
            overflowY: 'auto'
          }}
        >
          <button
            onClick={() => setSelectedCountry(null)}
            className="absolute top-2 right-2 p-1 rounded hover:bg-[var(--ds-gray-alpha-200)] transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)] mb-3 pr-6">
            Related Briefings {filteredBriefings.length > 0 && `(${filteredBriefings.length})`}
          </div>
          {filteredBriefings.length > 0 ? (
            <>
              <div className="space-y-3">
                {filteredBriefings.slice(0, 10).map((briefing) => (
                  <div key={briefing.id} className="text-[11px] border-l-2 border-[var(--ds-gray-alpha-300)] pl-3 py-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-[var(--ds-gray-600)] uppercase font-semibold">{briefing.source}</span>
                      <span className="text-[9px] text-[var(--ds-gray-500)]">{briefing.timestamp}</span>
                    </div>
                    <div className="text-[var(--ds-gray-1000)] leading-relaxed">{briefing.content}</div>
                  </div>
                ))}
                {filteredBriefings.length > 10 && (
                  <div className="text-[9px] text-[var(--ds-gray-600)] italic text-center pt-2 border-t border-[var(--ds-gray-alpha-200)]">
                    +{filteredBriefings.length - 10} more briefings
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[var(--ds-gray-600)] italic text-center py-4">
              No briefing news
            </div>
          )}
        </div>
      )}
    </div>
  );
}
