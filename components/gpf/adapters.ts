import type { GameSnapshot } from "@/engine";
import type { GeoPoint, HotspotCluster, MapMode, UiBriefingItem, UiHotspot, UiSignal, UiSignalConfidence } from "./types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function confToUi(c: "low" | "med" | "high"): UiSignalConfidence {
  return c === "high" ? "HIGH" : c === "med" ? "MED" : "LOW";
}

export type GpfDerived = {
  turn: number;
  periodLabel: string;
  pressureIndex: number; // 0-100
  deltaPerTurn: number; // 0..?
  narrativeGravity: number;
  systemStrain: number;
  hotspots: UiHotspot[];
  signals: UiSignal[];
  briefings: UiBriefingItem[];
  homeRegion: GeoPoint;
  hotspotClustersByMode: Record<import("./types").MapMode, HotspotCluster[]>;
  fogRegions: Array<{ lat: number; lon: number; radius: number }>;
};

export function deriveGpf(snapshot: GameSnapshot): GpfDerived {
  const ind = snapshot.playerView.indicators;
  const cr = snapshot.playerView.controlRoom;

  const legitimacy = ind.legitimacy.estimatedValue;
  const elite = ind.eliteCohesion.estimatedValue;
  const mil = ind.militaryLoyalty.estimatedValue;
  const unrest = ind.unrestLevel.estimatedValue;
  const econ = ind.economicStability.estimatedValue;
  const infl = ind.inflationPressure.estimatedValue;
  const intel = ind.intelligenceClarity.estimatedValue;
  const cred = ind.internationalCredibility.estimatedValue;
  const sov = ind.sovereigntyIntegrity.estimatedValue;
  const war = ind.warStatus.estimatedValue;

  const pressureIndexDet = Math.round(
    clamp(
      (100 - sov) * 0.32 +
        unrest * 0.2 +
        infl * 0.18 +
        war * 0.16 +
        (100 - cred) * 0.08 +
        (100 - econ) * 0.06,
      0,
      100,
    ),
  );

  const narrativeGravityDet = Math.round(clamp((100 - intel) * 0.55 + pressureIndexDet * 0.45, 0, 100));
  const systemStrainDet = Math.round(clamp((100 - econ) * 0.55 + infl * 0.25 + war * 0.2, 0, 100));

  const periodLabel = `Turn ${snapshot.turn}`;

  const confidence = confToUi(ind.intelligenceClarity.confidence);

  const signalsDet: UiSignal[] = [
    {
      id: "coup",
      label: "Coup Risk",
      intensity: clamp(((100 - legitimacy) + (100 - elite) + (100 - mil)) / 300, 0, 1),
      confidence,
    },
    {
      id: "border",
      label: "Border Flashpoints",
      intensity: clamp(Math.max((100 - sov) / 100, war / 100), 0, 1),
      confidence,
    },
    {
      id: "sanctions",
      label: "Sanctions Drag",
      intensity: clamp((infl / 100) * 0.55 + ((100 - econ) / 100) * 0.45, 0, 1),
      confidence,
    },
    {
      id: "alliance",
      label: "Alliance Drift",
      intensity: clamp((100 - cred) / 100, 0, 1),
      confidence,
    },
    {
      id: "energy",
      label: "Energy Shock",
      intensity: clamp(infl / 100, 0, 1),
      confidence,
    },
    {
      id: "capital",
      label: "Capital Flight",
      intensity: clamp(((100 - econ) / 100) * 0.7 + ((100 - legitimacy) / 100) * 0.3, 0, 1),
      confidence,
    },
  ];

  const hotspotsDet = deriveHotspots(snapshot, pressureIndexDet);
  const briefingsDet = deriveBriefingFeed(snapshot);

  const pressureIndex = cr?.pressure?.pressureIndex ?? pressureIndexDet;
  const narrativeGravity = cr?.pressure?.narrativeGravity ?? narrativeGravityDet;
  const systemStrain = cr?.pressure?.systemStrain ?? systemStrainDet;
  const deltaPerTurn = cr?.pressure?.deltaPerTurn ?? 0;

  const signals: UiSignal[] = cr?.signals?.length
    ? cr.signals.map((s) => ({ id: s.id, label: s.label, intensity: s.intensity, confidence: s.confidence }))
    : signalsDet;

  const hotspots: UiHotspot[] = cr?.hotspots?.length
    ? cr.hotspots.map((h) => ({ id: h.id, region: h.region, value: h.value, trend: h.trend, color: h.color }))
    : hotspotsDet;

  const briefings: UiBriefingItem[] = cr?.briefings?.length
    ? cr.briefings.map((b) => ({ id: b.id, timestamp: b.timestamp, source: b.source, content: b.content }))
    : briefingsDet;

  const homeRegion = cr?.map?.homeRegion ?? inferHomeRegion(snapshot);

  const clustersPressure =
    cr?.map?.clustersByMode?.pressure ??
    deriveClustersForMode({
      snapshot,
      mode: "pressure",
      home: homeRegion,
      pressureIndex,
      narrativeGravity,
      systemStrain,
      hotspots,
    });
  const clustersNarrative =
    cr?.map?.clustersByMode?.narrative ??
    deriveClustersForMode({
      snapshot,
      mode: "narrative",
      home: homeRegion,
      pressureIndex,
      narrativeGravity,
      systemStrain,
      hotspots,
    });
  const clustersEntanglement =
    cr?.map?.clustersByMode?.entanglement ??
    deriveClustersForMode({
      snapshot,
      mode: "entanglement",
      home: homeRegion,
      pressureIndex,
      narrativeGravity,
      systemStrain,
      hotspots,
    });
  const clustersSentiment =
    cr?.map?.clustersByMode?.sentiment ??
    deriveClustersForMode({
      snapshot,
      mode: "sentiment",
      home: homeRegion,
      pressureIndex,
      narrativeGravity,
      systemStrain,
      hotspots,
    });

  const fogRegions = cr?.map?.fogRegions ?? deriveFogRegions(snapshot, homeRegion);

  return {
    turn: snapshot.turn,
    periodLabel,
    pressureIndex,
    deltaPerTurn,
    narrativeGravity,
    systemStrain,
    hotspots,
    signals,
    briefings,
    homeRegion,
    hotspotClustersByMode: {
      pressure: clustersPressure,
      narrative: clustersNarrative,
      entanglement: clustersEntanglement,
      sentiment: clustersSentiment,
    },
    fogRegions,
  };
}

function deriveHotspots(snapshot: GameSnapshot, pressureIndex: number): UiHotspot[] {
  const events = snapshot.playerView.incomingEvents;
  const palette = {
    high: "#dc2626",
    med: "#f59e0b",
    low: "#22c55e",
  } as const;

  const out: UiHotspot[] = events.slice(0, 7).map((e, i) => {
    const base = e.urgency * 24 + pressureIndex * 0.35;
    const value = Math.round(clamp(base + (i === 0 ? 8 : 0), 0, 100));
    const trend = e.urgency >= 3 ? "up" : e.urgency === 2 ? "stable" : "down";
    const color = value >= 75 ? palette.high : value >= 50 ? palette.med : palette.low;
    return {
      id: e.id,
      region: eventRegionLabel(snapshot, e.type),
      value,
      trend,
      color,
    };
  });

  // Ensure there are always hotspots even if events list is short.
  if (out.length < 5) {
    const fill = [
      { id: "domestic", region: "Capital district", value: clamp(pressureIndex, 0, 100), trend: "stable" as const, color: palette.med },
      { id: "finance", region: "Financial channels", value: clamp(pressureIndex - 10, 0, 100), trend: "stable" as const, color: palette.low },
    ];
    for (const f of fill) if (out.length < 5) out.push(f);
  }

  return out.sort((a, b) => b.value - a.value);
}

function eventRegionLabel(snapshot: GameSnapshot, type: string): string {
  const neighbors = snapshot.countryProfile.neighbors;
  switch (type) {
    case "BORDER_INCIDENT":
      return neighbors.length ? `Frontier with ${neighbors[0]}` : "Disputed frontier";
    case "PROTESTS":
      return "Capital district";
    case "LEAKED_AUDIO":
      return "Cabinet / patronage networks";
    case "SANCTIONS_WARNING":
      return "Financial channels";
    case "ARMS_INTERDICTION":
      return "Procurement pipeline";
    case "IMF_CONTACT":
      return "Financing and conditionality";
    case "CYBER_INTRUSION":
      return "State networks";
    case "ALLIANCE_SIGNAL":
      return "Alliance perimeter";
    case "INSURGENT_ATTACK":
      return "Internal security belt";
    default:
      return "Situation";
  }
}

function deriveBriefingFeed(snapshot: GameSnapshot): UiBriefingItem[] {
  const b = snapshot.playerView.briefing;
  const nowish = ["now", "1h", "3h", "6h", "12h", "1d", "2d", "3d"];
  let idx = 0;

  const items: UiBriefingItem[] = [];

  for (const it of b.intelBriefs) {
    items.push({
      id: `intel-${idx}`,
      timestamp: nowish[idx++] ?? "—",
      source: "Intercept",
      content: it.text,
    });
  }

  for (const m of b.diplomaticMessages) {
    items.push({
      id: `dip-${idx}`,
      timestamp: nowish[idx++] ?? "—",
      source: "Embassy Cable",
      content: m,
    });
  }

  for (const h of b.headlines) {
    items.push({
      id: `hd-${idx}`,
      timestamp: nowish[idx++] ?? "—",
      source: "Markets",
      content: h,
    });
  }

  for (const r of b.domesticRumors) {
    items.push({
      id: `rum-${idx}`,
      timestamp: nowish[idx++] ?? "—",
      source: "Foreign Desk",
      content: r,
    });
  }

  // Add top incoming event as an extra note
  const e0 = snapshot.playerView.incomingEvents[0];
  if (e0) {
    items.unshift({
      id: `evt-${e0.id}`,
      timestamp: "now",
      source: "Foreign Desk",
      content: e0.visibleDescription,
    });
  }

  return items.slice(0, 10);
}

function inferHomeRegion(snapshot: GameSnapshot): GeoPoint {
  const n = snapshot.countryProfile.neighbors.join(" ").toLowerCase();
  const geo = snapshot.countryProfile.geographySummary.toLowerCase();

  // Heuristic mapping based on scenario templates.
  if (n.includes("greece") || n.includes("turkey") || geo.includes("mediterranean")) return { lat: 34.0, lon: 34.0 };
  if (n.includes("poland") || n.includes("ukraine") || geo.includes("eastern europe")) return { lat: 49.0, lon: 25.0 };
  if (n.includes("mali") || n.includes("niger") || geo.includes("sahel") || geo.includes("semi-arid")) return { lat: 14.0, lon: 3.0 };
  if (n.includes("malaysia") || n.includes("indonesia") || geo.includes("archipelagic") || geo.includes("southeast asia"))
    return { lat: 14.5, lon: 105.0 };

  // Default: central-ish
  return { lat: 38.9, lon: -77.0 };
}

function scalarToIntensity(n: number): "high" | "med" | "low" {
  return n >= 75 ? "high" : n >= 55 ? "med" : "low";
}

function modeScalar(args: {
  mode: MapMode;
  pressureIndex: number;
  narrativeGravity: number;
  systemStrain: number;
  internationalCredibility: number;
  warStatus: number;
}) {
  switch (args.mode) {
    case "pressure":
      return args.pressureIndex;
    case "narrative":
      return args.narrativeGravity;
    case "entanglement":
      return args.systemStrain;
    case "sentiment": {
      // When credibility collapses and war rises, global attitude hardens.
      return clamp((100 - args.internationalCredibility) * 0.65 + args.warStatus * 0.35, 0, 100);
    }
  }
}

function deriveClustersForMode(args: {
  snapshot: GameSnapshot;
  mode: MapMode;
  home: GeoPoint;
  pressureIndex: number;
  narrativeGravity: number;
  systemStrain: number;
  hotspots: UiHotspot[];
}): HotspotCluster[] {
  const ind = args.snapshot.playerView.indicators;
  const cred = ind.internationalCredibility.estimatedValue;
  const war = ind.warStatus.estimatedValue;

  const scalar = modeScalar({
    mode: args.mode,
    pressureIndex: args.pressureIndex,
    narrativeGravity: args.narrativeGravity,
    systemStrain: args.systemStrain,
    internationalCredibility: cred,
    warStatus: war,
  });

  const high = scalar >= 75;
  const homeIntensity = scalarToIntensity(scalar);

  const base: HotspotCluster[] = [
    {
      id: "home",
      lat: args.home.lat,
      lon: args.home.lon,
      intensity: homeIntensity,
      radius: args.mode === "entanglement" ? 48 : 40,
      dotCount: high ? 26 : 18,
    },
  ];

  // A small catalog of global tension points used to render the UI map. Selection is driven by current hotspots.
  const catalog: Array<
    Omit<HotspotCluster, "intensity"> & {
      intensityByModeAndType: Partial<Record<MapMode, Partial<Record<string, HotspotCluster["intensity"]>>>>;
    }
  > = [
    {
      id: "baltic",
      lat: 55.5,
      lon: 23.0,
      radius: 40,
      dotCount: 25,
      intensityByModeAndType: {
        pressure: { BORDER_INCIDENT: "high", ALLIANCE_SIGNAL: "med" },
        narrative: { ALLIANCE_SIGNAL: "med", CYBER_INTRUSION: "med" },
        entanglement: { SANCTIONS_WARNING: "med" },
        sentiment: { BORDER_INCIDENT: "high", ALLIANCE_SIGNAL: "med" },
      },
    },
    {
      id: "scs",
      lat: 12.0,
      lon: 114.5,
      radius: 50,
      dotCount: 30,
      intensityByModeAndType: {
        pressure: { SANCTIONS_WARNING: "med", BORDER_INCIDENT: "high" },
        narrative: { CYBER_INTRUSION: "med", ALLIANCE_SIGNAL: "low" },
        entanglement: { SANCTIONS_WARNING: "high", ARMS_INTERDICTION: "med" },
        sentiment: { SANCTIONS_WARNING: "med", BORDER_INCIDENT: "med" },
      },
    },
    {
      id: "sahel",
      lat: 14.0,
      lon: 3.0,
      radius: 55,
      dotCount: 20,
      intensityByModeAndType: {
        pressure: { INSURGENT_ATTACK: "high", PROTESTS: "med" },
        narrative: { PROTESTS: "high", LEAKED_AUDIO: "med" },
        entanglement: { IMF_CONTACT: "low" },
        sentiment: { PROTESTS: "high", INSURGENT_ATTACK: "med" },
      },
    },
    {
      id: "gulf",
      lat: 26.5,
      lon: 52.0,
      radius: 38,
      dotCount: 18,
      intensityByModeAndType: {
        pressure: { SANCTIONS_WARNING: "med" },
        narrative: { ALLIANCE_SIGNAL: "low" },
        entanglement: { SANCTIONS_WARNING: "high", IMF_CONTACT: "med" },
        sentiment: { SANCTIONS_WARNING: "med" },
      },
    },
    {
      id: "eastmed",
      lat: 34.0,
      lon: 34.0,
      radius: 32,
      dotCount: 15,
      intensityByModeAndType: {
        pressure: { BORDER_INCIDENT: "med", ARMS_INTERDICTION: "med" },
        narrative: { LEAKED_AUDIO: "low", CYBER_INTRUSION: "med" },
        entanglement: { ARMS_INTERDICTION: "high", IMF_CONTACT: "low" },
        sentiment: { BORDER_INCIDENT: "high", PROTESTS: "med" },
      },
    },
    {
      id: "andes",
      lat: -13.0,
      lon: -74.0,
      radius: 35,
      dotCount: 12,
      intensityByModeAndType: {
        pressure: { IMF_CONTACT: "low" },
        narrative: { LEAKED_AUDIO: "low" },
        entanglement: { IMF_CONTACT: "high", SANCTIONS_WARNING: "med" },
        sentiment: { IMF_CONTACT: "low" },
      },
    },
    {
      id: "london",
      lat: 51.5,
      lon: -0.1,
      radius: 34,
      dotCount: 16,
      intensityByModeAndType: {
        narrative: { LEAKED_AUDIO: "med", CYBER_INTRUSION: "high" },
        entanglement: { SANCTIONS_WARNING: "med", IMF_CONTACT: "med" },
        sentiment: { ALLIANCE_SIGNAL: "low" },
      },
    },
    {
      id: "singapore",
      lat: 1.35,
      lon: 103.82,
      radius: 34,
      dotCount: 16,
      intensityByModeAndType: {
        narrative: { CYBER_INTRUSION: "med" },
        entanglement: { SANCTIONS_WARNING: "high", ARMS_INTERDICTION: "med" },
      },
    },
  ];

  const eventTypes = args.snapshot.playerView.incomingEvents.map((e) => e.type);
  const chosen = new Map<string, HotspotCluster>();
  for (const et of eventTypes) {
    for (const c of catalog) {
      const intensity = c.intensityByModeAndType?.[args.mode]?.[et];
      if (!intensity) continue;
      if (!chosen.has(c.id)) chosen.set(c.id, { id: c.id, lat: c.lat, lon: c.lon, radius: c.radius, dotCount: c.dotCount, intensity });
    }
  }

  // Fall back to hotspots-driven extra nodes (max 3).
  const extras = Array.from(chosen.values()).slice(0, 3);
  const fromHotspots = args.hotspots
    .slice(0, args.mode === "pressure" ? 2 : 1)
    .map((h, i) => ({
      id: `derived-${i}`,
      lat: args.home.lat + (i === 0 ? (args.mode === "narrative" ? 9 : 6) : -8),
      lon: args.home.lon + (i === 0 ? (args.mode === "entanglement" ? 14 : 10) : -12),
      intensity:
        args.mode === "narrative"
          ? scalarToIntensity((h.value * 0.35 + args.narrativeGravity * 0.65))
          : args.mode === "entanglement"
            ? scalarToIntensity((h.value * 0.25 + args.systemStrain * 0.75))
            : args.mode === "sentiment"
              ? scalarToIntensity((h.value * 0.25 + (100 - cred) * 0.55 + war * 0.2))
              : scalarToIntensity(h.value),
      radius: 28 + i * 8 + (args.mode === "entanglement" ? 8 : 0),
      dotCount: 14 + i * 4 + (args.mode === "narrative" ? 4 : 0),
    })) satisfies HotspotCluster[];

  return [...base, ...extras, ...fromHotspots].slice(0, 6);
}

function deriveFogRegions(snapshot: GameSnapshot, home: GeoPoint) {
  const c = snapshot.playerView.indicators.intelligenceClarity.confidence;
  const base = c === "low" ? 3 : c === "med" ? 2 : 1;
  const regions = [
    { lat: home.lat + 10, lon: home.lon + 25, radius: 15 },
    { lat: home.lat - 6, lon: home.lon - 18, radius: 20 },
    { lat: home.lat + 2, lon: home.lon + 55, radius: 12 },
  ];
  return regions.slice(0, base);
}

