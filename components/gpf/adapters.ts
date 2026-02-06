import type { GameSnapshot } from "@/engine";
import type { CountryColorMap, UiBriefingItem, UiHotspot, UiSignal, UiSignalConfidence } from "./types";

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
  pressureIndexType: "relationship" | "world-events";
  deltaPerTurn: number;
  narrativeGravity: number;
  systemStrain: number;
  hotspots: UiHotspot[];
  signals: UiSignal[];
  briefings: UiBriefingItem[];
  countryColors: CountryColorMap[];
};

export function deriveGpf(snapshot: GameSnapshot, mode: "relationship" | "world-events" = "world-events"): GpfDerived {
  const ind = snapshot.playerView.indicators;
  const cred = ind.internationalCredibility.estimatedValue;
  const econ = ind.economicStability.estimatedValue;
  const infl = ind.inflationPressure.estimatedValue;
  const sov = ind.sovereigntyIntegrity.estimatedValue;
  const war = ind.warStatus.estimatedValue;
  const legitimacy = ind.legitimacy.estimatedValue;
  const elite = ind.eliteCohesion.estimatedValue;
  const mil = ind.militaryLoyalty.estimatedValue;
  const unrest = ind.unrestLevel.estimatedValue;
  const intel = ind.intelligenceClarity.estimatedValue;

  const periodLabel = `Turn ${snapshot.turn}`;
  const confidence = confToUi(ind.intelligenceClarity.confidence);

  // Pressure index for world-events based on overall system stress
  const pressureIndex = Math.round(
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

  const narrativeGravityDet = Math.round(clamp((100 - intel) * 0.55 + pressureIndex * 0.45, 0, 100));
  const systemStrainDet = Math.round(clamp((100 - econ) * 0.55 + infl * 0.25 + war * 0.2, 0, 100));

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

  const hotspotsDet = deriveHotspots(snapshot);
  const briefingsDet = deriveBriefingFeed(snapshot);
  const countryColors = deriveCountryColors(snapshot, mode);

  const hotspots: UiHotspot[] = hotspotsDet;
  const briefings: UiBriefingItem[] = briefingsDet;

  return {
    turn: snapshot.turn,
    periodLabel,
    pressureIndex,
    pressureIndexType: "world-events",
    deltaPerTurn: 0,
    narrativeGravity: narrativeGravityDet,
    systemStrain: systemStrainDet,
    hotspots,
    signals: signalsDet,
    briefings,
    countryColors,
  };
}

function deriveCountryColors(snapshot: GameSnapshot, mode: "relationship" | "world-events"): CountryColorMap[] {
  // Map of country codes to major world regions (simplified approximation)
  const countryLocationMap: Record<string, { lat: number; lon: number }> = {
    // Europe
    "DE": { lat: 51.17, lon: 10.45 },
    "FR": { lat: 46.57, lon: 2.21 },
    "GB": { lat: 55.37, lon: -3.44 },
    "RU": { lat: 61.52, lon: 105.32 },
    "UA": { lat: 48.37, lon: 31.17 },
    "PL": { lat: 51.92, lon: 19.15 },
    "IT": { lat: 41.87, lon: 12.57 },
    "ES": { lat: 40.46, lon: -3.75 },
    "SE": { lat: 60.13, lon: 18.64 },
    "NO": { lat: 60.47, lon: 8.47 },
    "BE": { lat: 50.50, lon: 4.48 },
    "NL": { lat: 52.13, lon: 5.29 },
    
    // America
    "US": { lat: 37.09, lon: -95.71 },
    "CA": { lat: 56.13, lon: -106.35 },
    "MX": { lat: 23.63, lon: -102.55 },
    "BR": { lat: -14.24, lon: -51.93 },
    "AR": { lat: -38.42, lon: -63.62 },
    "CL": { lat: -35.67, lon: -71.54 },
    
    // Asia
    "CN": { lat: 35.86, lon: 104.20 },
    "IN": { lat: 20.59, lon: 78.96 },
    "JP": { lat: 36.20, lon: 138.25 },
    "KR": { lat: 35.91, lon: 127.77 },
    "ID": { lat: -0.79, lon: 113.92 },
    "TH": { lat: 15.87, lon: 100.99 },
    "VN": { lat: 14.06, lon: 108.28 },
    "PK": { lat: 30.37, lon: 69.35 },
    "SG": { lat: 1.35, lon: 103.82 },
    "MY": { lat: 4.21, lon: 101.69 },
    "PH": { lat: 12.88, lon: 121.77 },
    
    // Middle East
    "SA": { lat: 23.89, lon: 45.08 },
    "AE": { lat: 23.42, lon: 53.85 },
    "IR": { lat: 32.43, lon: 53.69 },
    "IQ": { lat: 33.31, lon: 44.36 },
    "IL": { lat: 31.95, lon: 35.23 },
    "EG": { lat: 26.82, lon: 30.80 },
    "TR": { lat: 38.96, lon: 35.24 },
    "KW": { lat: 29.31, lon: 47.48 },
    "JO": { lat: 30.59, lon: 36.24 },
    "LB": { lat: 33.85, lon: 35.86 },
    
    // Africa
    "ZA": { lat: -30.56, lon: 22.94 },
    "NG": { lat: 9.08, lon: 8.68 },
    "ET": { lat: 9.15, lon: 40.49 },
    "KE": { lat: -0.02, lon: 37.91 },
    "MA": { lat: 31.79, lon: -7.09 },
    "TN": { lat: 33.89, lon: 9.54 },
    "UG": { lat: 1.37, lon: 32.29 },
    "GH": { lat: 7.37, lon: -5.55 },
    "ML": { lat: 17.57, lon: -4.00 },
    "CD": { lat: -4.04, lon: 21.76 },
    "AO": { lat: -11.20, lon: 17.87 },
    "SN": { lat: 14.50, lon: -14.45 },
    
    // Oceania
    "AU": { lat: -25.27, lon: 133.78 },
    "NZ": { lat: -40.90, lon: 174.89 },
  };

  const ind = snapshot.playerView.indicators;
  const cred = ind.internationalCredibility.estimatedValue;
  const econ = ind.economicStability.estimatedValue;
  const infl = ind.inflationPressure.estimatedValue;
  const unrest = ind.unrestLevel.estimatedValue;

  // Calculate relationship index based on economic health, credibility, and stability
  const relationshipIndex = Math.round(
    clamp(
      cred * 0.35 + econ * 0.3 + (100 - infl) * 0.2 + (100 - unrest) * 0.15,
      0,
      100,
    ),
  );

  // Determine event types from incoming events
  const eventTypes = snapshot.playerView.incomingEvents.map((e) => e.type);

  const colors: CountryColorMap[] = [];

  // For "world-events" mode: color all affected countries white to show activity
  if (mode === "world-events" && eventTypes.length > 0) {
    const eventCountries = new Set<string>();

    eventTypes.forEach((type) => {
      // Map event types to affected countries
      const affectedCountries: Record<string, string[]> = {
        BORDER_INCIDENT: ["RU", "PL", "UA", "CN", "IN"],
        SANCTIONS_WARNING: ["RU", "CN", "IR"],
        PROTESTS: ["US", "IN", "NG"],
        LEAKED_AUDIO: ["US", "GB", "FR"],
        ARMS_INTERDICTION: ["RU", "CN", "IR"],
        IMF_CONTACT: ["BR", "AR", "IN", "ZA", "NG"],
        CYBER_INTRUSION: ["US", "CN", "RU", "GB", "AU"],
        ALLIANCE_SIGNAL: ["US", "GB", "DE", "JP", "KR"],
        INSURGENT_ATTACK: ["IR", "IQ", "ML"],
      };

      const countries = affectedCountries[type];
      if (countries) {
        countries.forEach((cc) => eventCountries.add(cc));
      }
    });

    // Apply white color to all affected countries
    eventCountries.forEach((countryCode) => {
      const loc = countryLocationMap[countryCode];
      if (loc) {
        colors.push({
          countryCode,
          lat: loc.lat,
          lon: loc.lon,
          intensity: "high",
          color: "#ffffff",
        });
      }
    });
  }

  // For "relationship" mode: color countries based on their threat level and interactions
  if (mode === "relationship" && relationshipIndex > 30) {
    const mainActors: Array<{ code: string; threat: "high" | "med" | "low" }> = [
      { code: "US", threat: "high" },
      { code: "CN", threat: "high" },
      { code: "RU", threat: "high" },
      { code: "DE", threat: "med" },
      { code: "FR", threat: "med" },
      { code: "GB", threat: "med" },
      { code: "JP", threat: "med" },
      { code: "IN", threat: "low" },
      { code: "BR", threat: "low" },
    ];

    const countryThreatMap = new Map<string, "high" | "med" | "low">();

    // Assess threat based on incoming events
    eventTypes.forEach((type) => {
      // Events from external actors that threaten player indirectly
      const threatMap: Record<string, "high" | "med" | "low"> = {
        SANCTIONS_WARNING: "high",      // Sanctions indicate hostile relationship
        BORDER_INCIDENT: "high",        // Border incidents escalate tension
        CYBER_INTRUSION: "high",        // Cyber attacks are aggressive
        ARMS_INTERDICTION: "med",       // Procurement issues create friction
        PROTESTS: "med",                // Internal unrest is concerning
        IMF_CONTACT: "low",             // Financial engagement is neutral
        ALLIANCE_SIGNAL: "low",         // Alliance signals can be supportive
        LEAKED_AUDIO: "med",            // Intelligence gathering
        INSURGENT_ATTACK: "med",        // Regional instability
      };

      const threatLevel = threatMap[type] || "low";
      
      // Get source countries from events
      const eventCountries: Record<string, string[]> = {
        BORDER_INCIDENT: ["RU", "PL", "UA", "CN", "IN"],
        SANCTIONS_WARNING: ["US", "EU"],
        CYBER_INTRUSION: ["CN", "RU"],
        ARMS_INTERDICTION: ["RU", "CN"],
        ALLIANCE_SIGNAL: ["US", "GB", "DE"],
      };

      const countries = eventCountries[type];
      if (countries) {
        countries.forEach((cc) => {
          const current = countryThreatMap.get(cc);
          // Keep the highest threat level
          if (!current || (threatLevel === "high") || (threatLevel === "med" && current === "low")) {
            countryThreatMap.set(cc, threatLevel);
          }
        });
      }
    });

    // Color countries: red=high threat, yellow=med, green=low/friendly
    mainActors.forEach(({ code, threat }) => {
      const threatLevel = countryThreatMap.get(code) || threat;
      const loc = countryLocationMap[code];
      
      if (loc && !colors.some((c) => c.countryCode === code)) {
        colors.push({
          countryCode: code,
          lat: loc.lat,
          lon: loc.lon,
          intensity: threatLevel,
          color: threatLevel === "high" ? "#dc2626" : threatLevel === "med" ? "#eab308" : "#22c55e",
        });
      }
    });
  }

  return colors;
}

function deriveHotspots(snapshot: GameSnapshot): UiHotspot[] {
  const events = snapshot.playerView.incomingEvents;
  const ind = snapshot.playerView.indicators;
  const sov = ind.sovereigntyIntegrity.estimatedValue;
  const unrest = ind.unrestLevel.estimatedValue;
  const infl = ind.inflationPressure.estimatedValue;
  const war = ind.warStatus.estimatedValue;
  const cred = ind.internationalCredibility.estimatedValue;
  const econ = ind.economicStability.estimatedValue;

  // Recalculate pressure index for hotspot display
  const pressureIndex = Math.round(
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

