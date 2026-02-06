export type MapMode = "pressure" | "narrative" | "entanglement" | "sentiment";

export type Trend = "up" | "down" | "stable";

export type UiHotspot = {
  id: string;
  region: string;
  value: number; // 0-100
  trend: Trend;
  color: string;
};

export type UiSignalConfidence = "LOW" | "MED" | "HIGH";

export type UiSignal = {
  id: string;
  label: string;
  intensity: number; // 0..1
  confidence: UiSignalConfidence;
};

export type UiBriefingItem = {
  id: string;
  timestamp: string;
  source: "Intercept" | "Foreign Desk" | "Markets" | "Embassy Cable";
  content: string;
};

export type HotspotCluster = {
  id: string;
  lat: number;
  lon: number;
  intensity: "high" | "med" | "low";
  radius: number;
  dotCount: number;
};

export type GeoPoint = { lat: number; lon: number };

export const mapModeConfig: Record<
  MapMode,
  { label: string; hotspotLabel: string; legendLabel: string }
> = {
  pressure: {
    label: "Pressure",
    hotspotLabel: "TOP HOTSPOTS (PERCEIVED)",
    legendLabel: "Pressure Intensity",
  },
  narrative: {
    label: "Narrative",
    hotspotLabel: "NARRATIVE CENTERS",
    legendLabel: "Narrative Density",
  },
  entanglement: {
    label: "Entanglement",
    hotspotLabel: "ENTANGLEMENT NODES",
    legendLabel: "Connection Strength",
  },
  sentiment: {
    label: "Sentiment",
    hotspotLabel: "SENTIMENT NODES",
    legendLabel: "Attitude Toward You",
  },
};

