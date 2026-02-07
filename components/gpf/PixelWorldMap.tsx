"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { geoMercator } from "d3-geo";
import { mapModeConfig, type MapMode, type CountryColorMap, type UiBriefingItem } from "./types";

type DottedMapData = Record<string, Array<{ lon: number; lat: number; cityDistanceRank: number }>>;

// Color gradient configurations for each mode
const modeGradients: Record<MapMode, { low: string; mid: string; high: string }> = {
  pressure: { low: "#3b82f6", mid: "#f97316", high: "#dc2626" }, // blue -> orange -> red
  relationship: { low: "#22c55e", mid: "#eab308", high: "#dc2626" }, // green -> yellow -> red
  "world-events": { low: "#ffffff", mid: "#ffffff", high: "#ffffff" }, // white -> white -> white
};

// Interpolate color between three points using intensity (0-1)
const interpolateColor = (intensity: number, low: string, mid: string, high: string): string => {
  // Clamp intensity between 0 and 1
  const normalized = Math.max(0, Math.min(1, intensity));
  
  // Choose which gradient to use
  const [color1, color2] = normalized < 0.5 
    ? [low, mid] 
    : [mid, high];
  
  // Calculate position within the chosen gradient
  const t = normalized < 0.5 ? normalized * 2 : (normalized - 0.5) * 2;
  
  return lerpColor(color1, color2, t);
};

// Linear interpolation between two hex colors
const lerpColor = (color1: string, color2: string, t: number): string => {
  const hex1 = color1.replace("#", "");
  const hex2 = color2.replace("#", "");
  
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

// Map discrete intensity to continuous value for gradient
const intensityToContinuous = (intensity: "high" | "med" | "low" | "uncolored"): number => {
  const map = { uncolored: -1, low: 0.25, med: 0.5, high: 1 };
  return map[intensity] ?? -1;
};

const ColoredPixel = memo(
  ({ x, y, color, onMouseEnter, onMouseLeave, isHovered }: { x: number; y: number; color: string; onMouseEnter?: () => void; onMouseLeave?: () => void; isHovered?: boolean }) => {
    // When hovered, use bright white; otherwise use the country's color
    const displayColor = isHovered ? "#ffffff" : color;
    
    return (
      <g onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ cursor: onMouseEnter ? 'pointer' : 'default' }} pointerEvents={onMouseEnter ? 'all' : 'none'}>
        {/* Larger invisible rect for easier hovering */}
        {onMouseEnter && (
          <rect 
            x={x - 3} 
            y={y - 3} 
            width={15} 
            height={15}
            fill="transparent"
            pointerEvents="all"
          />
        )}
        
        {/* Core pixel with conditional styling */}
        <rect 
          x={x} 
          y={y} 
          width={2.5} 
          height={2.5} 
          fill={displayColor} 
          opacity={isHovered ? 1 : 0.95}
          pointerEvents="none"
          style={{
            filter: isHovered ? 'drop-shadow(0 0 4px #ffffff) drop-shadow(0 0 8px #ffffff) drop-shadow(0 0 12px #ffffff)' : `drop-shadow(0 0 1px ${displayColor})`
          }}
        />
      </g>
    );
  }
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
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [panelHovered, setPanelHovered] = useState(false);
  const [hoveredCountryX, setHoveredCountryX] = useState<number | null>(null);

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

  // Build map of country code to color - now using gradient interpolation
  const countryColorMap = useMemo(() => {
    const map = new Map<string, { color: string; intensity: "high" | "med" | "low" | "uncolored"; continuousIntensity: number }>();
    const gradients = modeGradients[mode];
    
    countryColors.forEach((cc) => {
      const continuousIntensity = intensityToContinuous(cc.intensity);
      const color = continuousIntensity < 0 
        ? "#999999" 
        : interpolateColor(continuousIntensity, gradients.low, gradients.mid, gradients.high);
      
      map.set(cc.countryCode, { color, intensity: cc.intensity, continuousIntensity });
    });
    return map;
  }, [countryColors, mode]);

  // special marker inserted by adapters when player's country is fictional
  // (countryCode === "__PLAYER__"). Contains lat/lon of inferred location.
  const playerLocation = useMemo(() => countryColors.find((c) => c.countryCode === "__PLAYER__"), [countryColors]);

  // Pre-index briefings by country for O(1) lookup on hover
  const briefingsByCountry = useMemo(() => {
    const map = new Map<string, Set<string>>();
    
    if (!countryCodeToNames || briefings.length === 0) return map;
    
    briefings.forEach((briefing) => {
      const lowerContent = briefing.content.toLowerCase();
      
      countryCodeToNames.forEach((possibleNames, countryCode) => {
        for (const name of possibleNames) {
          if (lowerContent.includes(name)) {
            if (!map.has(countryCode)) {
              map.set(countryCode, new Set());
            }
            map.get(countryCode)!.add(briefing.id);
            break; // Found a match for this country, move to next briefing
          }
        }
      });
    });
    
    return map;
  }, [briefings, countryCodeToNames]);

  // Fast lookup of briefings for hovered country using pre-indexed map
  const filteredBriefings = useMemo(() => {
    if (!hoveredCountry) return [];
    
    const briefingIds = briefingsByCountry.get(hoveredCountry);
    if (!briefingIds || briefingIds.size === 0) return [];
    
    return briefings.filter((b) => briefingIds.has(b.id));
  }, [hoveredCountry, briefingsByCountry, briefings]);

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

  // Debounced hover handlers to prevent flickering when moving between pixels
  const handlePixelEnter = (countryCode: string, x: number) => {
    setHoveredCountry(countryCode);
    setHoveredCountryX(x);
  };

  const handlePixelLeave = () => {
    // Only clear hover if panel is not hovered
    if (!panelHovered) {
      setHoveredCountry(null);
      setHoveredCountryX(null);
    }
  };

  const config = mapModeConfig[mode];
  const gradients = modeGradients[mode];

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
                  isHovered={hoveredCountry === p.countryCode}
                  onMouseEnter={mode === "world-events" ? () => handlePixelEnter(p.countryCode, p.x) : undefined}
                  onMouseLeave={mode === "world-events" ? handlePixelLeave : undefined}
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
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: gradients.high }} />
            <span className="text-[var(--ds-gray-900)]">High</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: gradients.mid }} />
            <span className="text-[var(--ds-gray-900)]">Med</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: gradients.low }} />
            <span className="text-[var(--ds-gray-900)]">Low</span>
          </div>
        </div>
      </div>

      {/* Briefings Panel - only in world-events mode */}
      {mode === "world-events" && (hoveredCountry || panelHovered) && (
        <div 
          className="absolute top-4 z-50 w-96 max-w-[calc(100%-2rem)] p-4 bg-[var(--ds-background-100)]/95 border border-[var(--ds-gray-alpha-400)] rounded-lg shadow-xl"
          style={{
            maxHeight: '500px',
            overflowY: 'auto',
            [hoveredCountryX !== null && hoveredCountryX > width / 2 ? 'left' : 'right']: '1rem'
          }}
          onMouseEnter={() => setPanelHovered(true)}
          onMouseLeave={() => setPanelHovered(false)}
        >
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)] mb-3">
            {hoveredCountry && countryCodeToNames?.get(hoveredCountry) 
              ? Array.from(countryCodeToNames.get(hoveredCountry) || [])[0] 
              : 'Briefings'}
            {filteredBriefings.length > 0 && ` (${filteredBriefings.length})`}
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
