"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { geoMercator, type GeoProjection } from "d3-geo";
import { mapModeConfig, type MapMode, type CountryColorMap, type UiBriefingItem } from "./types";

type DottedMapData = Record<string, Array<{ lon: number; lat: number; cityDistanceRank: number }>>;

// Intensity to color mapping for relationship mode
// Good (low intensity) = Green, Okay (med) = Yellow/Orange, Bad (high) = Red
const intensityToColor = (intensity: "high" | "med" | "low" | "uncolored"): string => {
  const colorMap = {
    low: "#22c55e",      // Green = Good
    med: "#eab308",      // Yellow/Orange = Okay
    high: "#dc2626",     // Red = Bad
    uncolored: "#999999" // Grey = No data
  };
  return colorMap[intensity];
};

// Hotspot interface
interface Hotspot {
  id: string;
  x: number;
  y: number;
  color: string;
  intensity: "high" | "med" | "low" | "uncolored";
  size: number; // radius in pixels
  countryCode: string;
}

const GreyPixel = memo(
  ({ 
    x, 
    y, 
    onMouseEnter, 
    onMouseLeave,
    isHovered = false,
    glow = true
  }: { 
    x: number; 
    y: number; 
    countryCode?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    isHovered?: boolean;
    glow?: boolean;
  }) => {
    const pixelColor = isHovered ? "#ffffff" : "#e6e6e6";
    const pixelOpacity = isHovered ? 1 : 0.5;
    const hoverColor = glow ? "#ffffff" : "#fdfdfd";
    
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
        <rect 
          x={x} 
          y={y} 
          width={3.125} 
          height={3.125} 
          fill={isHovered ? hoverColor : pixelColor} 
          opacity={pixelOpacity}
          style={{
            filter: isHovered && glow
              ? 'drop-shadow(0 0 3px #ffffff) drop-shadow(0 0 6px #ffffff) drop-shadow(0 0 12px rgba(255,255,255,0.9))'
              : 'none'
          }}
        />
      </g>
    );
  }
);
GreyPixel.displayName = "GreyPixel";

// Animated hotspot component with glow effect
const AnimatedHotspot = memo(
  ({ hotspot, animationOffset }: { hotspot: Hotspot; animationOffset: number }) => {
    const { x, y, color, size } = hotspot;
    
    return (
      <g>
        {/* Radial glow/halo effect using animated SVG filter */}
        <defs>
          <radialGradient id={`glow-${hotspot.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="70%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          
          <filter id={`hotspot-filter-${hotspot.id}`}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={size * 0.3} />
          </filter>
        </defs>

        {/* Outer glow halo - static */}
        <circle
          cx={x}
          cy={y}
          r={size * 2}
          fill={`url(#glow-${hotspot.id})`}
          pointerEvents="none"
        />

        {/* Core hotspot circle with size pulsing */}
        <circle
          cx={x}
          cy={y}
          r={size}
          fill={color}
          pointerEvents="none"
            style={{
              filter: `drop-shadow(0 0 ${size * 0.6}px ${color}) drop-shadow(0 0 ${size * 1.2}px ${color}55)`,
              animationName: "hotspot-pulse",
              animationDuration: "3.6s",
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationDelay: `${animationOffset * 0.18}s`,
              transformOrigin: `${x}px ${y}px`
            }}
        />

        {/* Inner bright core */}
        <circle
          cx={x}
          cy={y}
          r={size * 0.4}
          fill={color}
          pointerEvents="none"
          style={{
            animationName: "hotspot-core-pulse",
            animationDuration: "3.6s",
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDelay: `${animationOffset * 0.18}s`,
            transformOrigin: `${x}px ${y}px`
          }}
        />
      </g>
    );
  }
);
AnimatedHotspot.displayName = "AnimatedHotspot";


interface PixelWorldMapProps {
  width?: number;
  height?: number;
  mode: MapMode;
  countryColors: CountryColorMap[];
  briefings?: UiBriefingItem[];
  countryCodeToNames?: Map<string, Set<string>>;
  neighborNames?: string[];
}

// Generate hotspots for a country based on its size
// Larger countries get more hotspots, smaller countries get fewer
const generateCountryHotspots = (
  countryCode: string,
  cities: Array<{ lon: number; lat: number; cityDistanceRank: number }>,
  projection: GeoProjection,
  intensity: "high" | "med" | "low" | "uncolored",
  color: string
): Hotspot[] => {
  if (intensity === "uncolored" || cities.length === 0) return [];

  // Determine number of hotspots based on country size (number of cities)
  let hotspotCount: number;
  if (cities.length <= 5) {
    hotspotCount = 2; // Very small country
  } else if (cities.length <= 15) {
    hotspotCount = 4; // Small country
  } else if (cities.length <= 30) {
    hotspotCount = 8; // Medium-small country
  } else if (cities.length <= 60) {
    hotspotCount = 15; // Medium country
  } else if (cities.length <= 120) {
    hotspotCount = 25; // Large country
  } else if (cities.length <= 200) {
    hotspotCount = 40; // Very large country
  } else {
    hotspotCount = 60; // Huge country
  }

  const shouldCluster = hotspotCount >= 40;
  const regions = shouldCluster ? 4 : 1;
  const hotspotsPerRegion = Math.max(1, Math.floor(hotspotCount / regions));
  const hotspots: Hotspot[] = [];

  const lonValues = cities.map((c) => c.lon).sort((a, b) => a - b);
  const latValues = cities.map((c) => c.lat).sort((a, b) => a - b);
  const lonMid = lonValues[Math.floor(lonValues.length / 2)] ?? 0;
  const latMid = latValues[Math.floor(latValues.length / 2)] ?? 0;

  const regionCities = shouldCluster
    ? [
        cities.filter((c) => c.lon <= lonMid && c.lat >= latMid),
        cities.filter((c) => c.lon > lonMid && c.lat >= latMid),
        cities.filter((c) => c.lon <= lonMid && c.lat < latMid),
        cities.filter((c) => c.lon > lonMid && c.lat < latMid),
      ]
    : [cities];

  regionCities.forEach((regionList, regionIndex) => {
    if (regionList.length === 0) return;
    const targetCount = shouldCluster ? hotspotsPerRegion : hotspotCount;
    const step = Math.max(1, Math.floor(regionList.length / targetCount));

    const picked: Array<{ lon: number; lat: number; cityDistanceRank: number }> = [];
    for (let i = 0; i < targetCount && i * step < regionList.length; i++) {
      picked.push(regionList[i * step]);
    }

    if (picked.length < targetCount) {
      for (let i = 0; i < regionList.length && picked.length < targetCount; i++) {
        picked.push(regionList[i]);
      }
    }

    picked.forEach((city, index) => {
      const coords = projection([city.lon, city.lat]);
      if (!coords) return;

      const [px, py] = coords;
      const isLarge = (index + regionIndex) % 5 === 0;
      const size = isLarge ? 7 : 4;

      hotspots.push({
        id: `${countryCode}-hotspot-${regionIndex}-${index}`,
        x: px,
        y: py,
        color,
        intensity,
        size,
        countryCode,
      });
    });
  });

  return hotspots;
};

export default function PixelWorldMap({
  width = 1000,
  height = 560,
  mode,
  countryColors,
  briefings = [],
  countryCodeToNames,
  neighborNames = [],
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
        .center([5, 25])
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

  // Build map of country code to intensity
  const countryIntensityMap = useMemo(() => {
    const map = new Map<string, "high" | "med" | "low" | "uncolored">();
    
    countryColors.forEach((cc) => {
      map.set(cc.countryCode, cc.intensity);
    });
    return map;
  }, [countryColors]);

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
            break;
          }
        }
      });
    });
    
    return map;
  }, [briefings, countryCodeToNames]);

  // Fast lookup of briefings for hovered country
  const filteredBriefings = useMemo(() => {
    if (!hoveredCountry) return [];
    
    const briefingIds = briefingsByCountry.get(hoveredCountry);
    if (!briefingIds || briefingIds.size === 0) return [];
    
    return briefings.filter((b) => briefingIds.has(b.id));
  }, [hoveredCountry, briefingsByCountry, briefings]);

  const neighborCountryCodes = useMemo(() => {
    if (!countryCodeToNames || neighborNames.length === 0) return [] as string[];
    const normalizedNeighbors = neighborNames.map((n) => n.toLowerCase());
    const codes = new Set<string>();

    countryCodeToNames.forEach((possibleNames, countryCode) => {
      for (const name of possibleNames) {
        const normalizedName = name.toLowerCase();
        if (normalizedNeighbors.some((n) => n === normalizedName || n.includes(normalizedName) || normalizedName.includes(n))) {
          codes.add(countryCode);
          break;
        }
      }
    });

    return Array.from(codes);
  }, [countryCodeToNames, neighborNames]);

  const inferredLocation = useMemo(() => {
    if (!dottedMapData || neighborCountryCodes.length === 0) return null;

    let sumLat = 0;
    let sumLon = 0;
    let count = 0;

    neighborCountryCodes.forEach((code) => {
      const cities = dottedMapData[code];
      if (!cities || cities.length === 0) return;
      const sample = cities.slice(0, Math.min(20, cities.length));
      sample.forEach((city) => {
        sumLat += city.lat;
        sumLon += city.lon;
        count += 1;
      });
    });

    if (count === 0) return null;
    return { lat: sumLat / count, lon: sumLon / count };
  }, [dottedMapData, neighborCountryCodes]);

  const inferredPoint = useMemo(() => {
    if (!inferredLocation) return null;
    return projection([inferredLocation.lon, inferredLocation.lat]);
  }, [inferredLocation, projection]);


  // Generate all pixels as grey (uncolored)
  const pixels = useMemo(() => {
    const result: Array<{
      key: string;
      x: number;
      y: number;
      lon: number;
      lat: number;
      countryCode: string;
    }> = [];

    if (!dottedMapData) return result;

    Object.entries(dottedMapData).forEach(([countryCode, cities]) => {
      cities.forEach((city) => {
        const coords = projection([city.lon, city.lat]);
        if (!coords) return;

        const [x, y] = coords;
        if (x < 0 || x > width || y < 0 || y > height) return;

        result.push({
          key: `pixel-${countryCode}-${city.lon}-${city.lat}`,
          x,
          y,
          lon: city.lon,
          lat: city.lat,
          countryCode,
        });
      });
    });

    return result;
  }, [dottedMapData, projection, width, height]);

  const locationPixelKeys = useMemo(() => {
    if (mode !== "location" || !inferredPoint) return new Set<string>();
    const [cx, cy] = inferredPoint;
    const radius = 26;
    const maxCount = 90;
    const result = new Set<string>();
    for (const p of pixels) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        result.add(p.key);
        if (result.size >= maxCount) break;
      }
    }
    return result;
  }, [mode, inferredPoint, pixels]);

  // Generate hotspots only for relationship mode
  const hotspots = useMemo(() => {
    if (mode !== "relationship" || !dottedMapData) return [];

    const allHotspots: Hotspot[] = [];

    Object.entries(dottedMapData).forEach(([countryCode, cities]) => {
      const intensity = countryIntensityMap.get(countryCode) || "uncolored";
      const color = intensityToColor(intensity);
      
      const countryHotspots = generateCountryHotspots(
        countryCode,
        cities,
        projection,
        intensity,
        color
      );
      
      allHotspots.push(...countryHotspots);
    });

    return allHotspots;
  }, [mode, dottedMapData, projection, countryIntensityMap]);

  // Hover handlers for world-events mode
  const handlePixelEnter = (countryCode: string, x: number) => {
    setHoveredCountry(countryCode);
    setHoveredCountryX(x);
  };

  const handlePixelLeave = () => {
    if (!panelHovered) {
      setHoveredCountry(null);
      setHoveredCountryX(null);
    }
  };

  const config = mapModeConfig[mode];

  return (
    <div className="relative w-full">
      {dottedMapErr ? (
        <div className="absolute top-2 left-2 z-10 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 px-2 py-1 text-[10px] font-mono text-[var(--ds-red-700)]">
          Map dataset missing: {dottedMapErr}
        </div>
      ) : null}
      
      <style>{`
        @keyframes hotspot-pulse {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.22); opacity: 0.95; }
        }

        @keyframes hotspot-core-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }

        @keyframes location-pulse {
          0%, 100% { transform: scale(0.9); opacity: 0.35; }
          50% { transform: scale(1.2); opacity: 0.9; }
        }
        
        @keyframes pulse-glow {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.35); opacity: 0.12; }
        }
      `}</style>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-[var(--ds-background-100)]">
        <g>
          {/* All pixels rendered as grey */}
          {pixels.map((p) =>
            mode === "world-events" ? (
              <GreyPixel 
                key={p.key} 
                x={p.x} 
                y={p.y}
                countryCode={p.countryCode}
                isHovered={hoveredCountry === p.countryCode}
                onMouseEnter={() => handlePixelEnter(p.countryCode, p.x)}
                onMouseLeave={handlePixelLeave}
              />
            ) : mode === "location" ? (
              <GreyPixel
                key={p.key}
                x={p.x}
                y={p.y}
                isHovered={locationPixelKeys.has(p.key)}
                glow={false}
              />
            ) : (
              <GreyPixel key={p.key} x={p.x} y={p.y} />
            )
          )}
        </g>

        {/* Inferred location marker - only rendered in world-events mode */}
        {inferredPoint && mode === "world-events" && (
          <g>
            <circle
              cx={inferredPoint[0]}
              cy={inferredPoint[1]}
              r={26}
              fill="rgba(255, 255, 255, 0.25)"
              style={{
                filter: "blur(2px)",
                animationName: "location-pulse",
                animationDuration: "4s",
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                transformOrigin: `${inferredPoint[0]}px ${inferredPoint[1]}px`,
              }}
            />
            <circle
              cx={inferredPoint[0]}
              cy={inferredPoint[1]}
              r={10}
              fill="rgba(255, 255, 255, 0.9)"
              style={{
                filter: "drop-shadow(0 0 8px rgba(255,255,255,0.9))",
              }}
            />
          </g>
        )}

        {/* Hotspots layer - only rendered in relationship mode */}
        {mode === "relationship" && (
          <g>
            {hotspots.map((hotspot, index) => (
              <AnimatedHotspot 
                key={hotspot.id} 
                hotspot={hotspot} 
                animationOffset={index}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Legend - shows bad/okay/good for relationship mode */}
      {mode === "relationship" && (
        <div className="absolute bottom-2 left-2 p-2 bg-[var(--ds-background-100)]/80 backdrop-blur-sm border border-[var(--ds-gray-alpha-400)] rounded text-[10px] font-mono">
          <div className="text-[var(--ds-gray-900)] uppercase mb-1.5">{config.legendLabel}</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#22c55e" }} />
              <span className="text-[var(--ds-gray-900)]">Good</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#eab308" }} />
              <span className="text-[var(--ds-gray-900)]">Okay</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#dc2626" }} />
              <span className="text-[var(--ds-gray-900)]">Bad</span>
            </div>
          </div>
        </div>
      )}

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
