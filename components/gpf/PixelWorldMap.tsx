"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { geoMercator } from "d3-geo";
import { mapModeConfig, type HotspotCluster, type MapMode, type GeoPoint } from "./types";

type DottedMapData = Record<string, Array<{ lon: number; lat: number; cityDistanceRank: number }>>;

const modeColors: Record<MapMode, { high: string; med: string; low: string }> = {
  pressure: { high: "#dc2626", med: "#f59e0b", low: "#22c55e" },
  narrative: { high: "#3b82f6", med: "#8b5cf6", low: "#06b6d4" },
  entanglement: { high: "#ec4899", med: "#f97316", low: "#84cc16" },
};

const StaticPixel = memo(({ x, y }: { x: number; y: number }) => (
  <rect x={x} y={y} width={3} height={3} fill="rgba(255, 255, 255, 0.5)" />
));
StaticPixel.displayName = "StaticPixel";

const ClusterDot = memo(
  ({
    x,
    y,
    color,
    size,
    delay,
    intensity,
  }: {
    x: number;
    y: number;
    color: string;
    size: number;
    delay: number;
    intensity: "high" | "med" | "low";
  }) => {
    const pulseSpeed = intensity === "high" ? 1.2 : intensity === "med" ? 1.8 : 2.5;
    const baseOpacity = intensity === "high" ? 0.9 : intensity === "med" ? 0.7 : 0.5;

    return (
      <motion.circle
        cx={x}
        cy={y}
        r={size}
        fill={color}
        initial={{ opacity: baseOpacity * 0.5 }}
        animate={{
          opacity: [baseOpacity * 0.5, baseOpacity, baseOpacity * 0.5],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: pulseSpeed,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
          delay: delay,
        }}
        style={{ transformOrigin: `${x}px ${y}px` }}
      />
    );
  },
);
ClusterDot.displayName = "ClusterDot";

interface PixelWorldMapProps {
  width?: number;
  height?: number;
  mode: MapMode;
  intelFog: boolean;
  showExposure: boolean;
  hotspotClusters: HotspotCluster[];
  homeRegion: GeoPoint;
  fogRegions: Array<{ lat: number; lon: number; radius: number }>;
}

export default function PixelWorldMap({
  width = 1000,
  height = 560,
  mode,
  intelFog,
  showExposure,
  hotspotClusters,
  homeRegion,
  fogRegions,
}: PixelWorldMapProps) {
  const [fogNoise, setFogNoise] = useState<Array<{ x: number; y: number; opacity: number }>>([]);
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
    if (!intelFog) {
      setFogNoise([]);
      return;
    }
    const noise: Array<{ x: number; y: number; opacity: number }> = [];
    fogRegions.forEach((region) => {
      const center = projection([region.lon, region.lat]);
      if (!center) return;
      for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * region.radius * 8;
        noise.push({
          x: center[0] + Math.cos(angle) * distance,
          y: center[1] + Math.sin(angle) * distance,
          opacity: 0.1 + Math.random() * 0.3,
        });
      }
    });
    setFogNoise(noise);
  }, [intelFog, projection, fogRegions]);

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

  const staticPixels = useMemo(() => {
    const pixels: Array<{ key: string; x: number; y: number }> = [];
    if (!dottedMapData) return pixels;

    Object.entries(dottedMapData).forEach(([countryCode, cities]) => {
      cities.forEach((city) => {
        const coords = projection([city.lon, city.lat]);
        if (!coords) return;

        const [x, y] = coords;
        if (x < 0 || x > width || y < 0 || y > height) return;

        pixels.push({
          key: `${countryCode}-${city.cityDistanceRank}`,
          x,
          y,
        });
      });
    });

    return pixels;
  }, [dottedMapData, projection, width, height]);

  const clusterDots = useMemo(() => {
    const colors = modeColors[mode];
    const allDots: Array<{
      key: string;
      x: number;
      y: number;
      color: string;
      size: number;
      delay: number;
      intensity: "high" | "med" | "low";
    }> = [];

    const seededRandom = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };

    hotspotClusters.forEach((cluster) => {
      const centerCoords = projection([cluster.lon, cluster.lat]);
      if (!centerCoords) return;

      const [cx, cy] = centerCoords;
      const color = colors[cluster.intensity];

      for (let i = 0; i < cluster.dotCount; i++) {
        const seed = cluster.id.charCodeAt(0) * 1000 + i;
        const angle = seededRandom(seed) * Math.PI * 2;
        const distance = seededRandom(seed + 1) * cluster.radius;

        const distanceRatio = distance / cluster.radius;
        const baseSize = cluster.intensity === "high" ? 5 : cluster.intensity === "med" ? 4 : 3;
        const size = baseSize * (1.2 - distanceRatio * 0.7);

        allDots.push({
          key: `${cluster.id}-${i}`,
          x: cx + Math.cos(angle) * distance,
          y: cy + Math.sin(angle) * distance,
          color,
          size,
          delay: seededRandom(seed + 2) * 2,
          intensity: cluster.intensity,
        });
      }
    });

    return allDots;
  }, [projection, mode, hotspotClusters]);

  const glowGradients = useMemo(() => {
    const colors = modeColors[mode];
    return hotspotClusters
      .map((cluster) => {
        const coords = projection([cluster.lon, cluster.lat]);
        if (!coords) return null;
        return {
          id: `glow-${cluster.id}`,
          cx: coords[0],
          cy: coords[1],
          r: cluster.radius * 1.5,
          color: colors[cluster.intensity],
          intensity: cluster.intensity,
        };
      })
      .filter(Boolean);
  }, [projection, mode, hotspotClusters]);

  const homeCoords = useMemo(() => {
    return projection([homeRegion.lon, homeRegion.lat]);
  }, [projection, homeRegion]);

  const config = mapModeConfig[mode];

  return (
    <div className="relative w-full">
      {dottedMapErr ? (
        <div className="absolute top-2 left-2 z-10 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 px-2 py-1 text-[10px] font-mono text-[var(--ds-red-700)]">
          Map dataset missing: {dottedMapErr}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-[var(--ds-background-100)]">
        <defs>
          {glowGradients.map(
            (glow) =>
              glow && (
                <radialGradient key={glow.id} id={glow.id}>
                  <stop
                    offset="0%"
                    stopColor={glow.color}
                    stopOpacity={glow.intensity === "high" ? 0.4 : glow.intensity === "med" ? 0.25 : 0.15}
                  />
                  <stop
                    offset="50%"
                    stopColor={glow.color}
                    stopOpacity={glow.intensity === "high" ? 0.15 : glow.intensity === "med" ? 0.08 : 0.05}
                  />
                  <stop offset="100%" stopColor={glow.color} stopOpacity="0" />
                </radialGradient>
              ),
          )}
          <radialGradient id="exposureGradient">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g>
          {staticPixels.map((p) => (
            <StaticPixel key={p.key} x={p.x} y={p.y} />
          ))}
        </g>

        <g>
          {glowGradients.map(
            (glow) =>
              glow && (
                <motion.circle
                  key={`bg-${glow.id}`}
                  cx={glow.cx}
                  cy={glow.cy}
                  r={glow.r}
                  fill={`url(#${glow.id})`}
                  animate={{
                    r: [glow.r * 0.9, glow.r * 1.1, glow.r * 0.9],
                    opacity: [0.8, 1, 0.8],
                  }}
                  transition={{
                    duration: glow.intensity === "high" ? 2 : glow.intensity === "med" ? 3 : 4,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                />
              ),
          )}
        </g>

        <g>
          {clusterDots.map((dot) => (
            <ClusterDot
              key={dot.key}
              x={dot.x}
              y={dot.y}
              color={dot.color}
              size={dot.size}
              delay={dot.delay}
              intensity={dot.intensity}
            />
          ))}
        </g>

        {showExposure && homeCoords && (
          <g>
            <motion.circle
              cx={homeCoords[0]}
              cy={homeCoords[1]}
              r={60}
              fill="url(#exposureGradient)"
              animate={{
                r: [55, 65, 55],
                opacity: [0.8, 1, 0.8],
              }}
              transition={{
                duration: 3,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
            <circle cx={homeCoords[0]} cy={homeCoords[1]} r={4} fill="#3b82f6" opacity={0.8} />
          </g>
        )}

        {intelFog && (
          <g>
            {fogNoise.map((n, i) => (
              <rect
                key={`fog-${i}`}
                x={n.x}
                y={n.y}
                width={8 + Math.random() * 8}
                height={8 + Math.random() * 8}
                fill="var(--ds-background-100)"
                opacity={n.opacity}
              />
            ))}
          </g>
        )}
      </svg>

      <div className="absolute bottom-2 left-2 p-2 bg-[var(--ds-background-100)]/80 backdrop-blur-sm border border-[var(--ds-gray-alpha-400)] rounded text-[10px] font-mono">
        <div className="text-[var(--ds-gray-900)] uppercase mb-1.5">{config.legendLabel}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: modeColors[mode].high }} />
            <span className="text-[var(--ds-gray-900)]">High</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: modeColors[mode].med }} />
            <span className="text-[var(--ds-gray-900)]">Med</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: modeColors[mode].low }} />
            <span className="text-[var(--ds-gray-900)]">Low</span>
          </div>
        </div>
        {intelFog && (
          <div className="mt-1.5 pt-1.5 border-t border-[var(--ds-gray-alpha-400)] text-[var(--ds-gray-600)]">
            Fog: Signal confidence degraded
          </div>
        )}
      </div>
    </div>
  );
}

