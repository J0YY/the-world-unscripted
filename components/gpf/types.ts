export type MapMode = "pressure" | "relationship" | "world-events";

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

export type CountryColorMap = {
  countryCode: string;
  lat: number;
  lon: number;
  intensity: "high" | "med" | "low" | "uncolored";
  color?: string;
};

export type GeoPoint = { lat: number; lon: number };

export const mapModeConfig: Record<
  MapMode,
  { label: string; legendLabel: string; hotspotLabel: string }
> = {
  pressure: {
    label: "Pressure",
    legendLabel: "Global Pressure",
    hotspotLabel: "Pressure Points",
  },
  relationship: {
    label: "Relationship",
    legendLabel: "International Relations",
    hotspotLabel: "Key Relations",
  },
  "world-events": {
    label: "World Events",
    legendLabel: "Event Impact",
    hotspotLabel: "Active Events",
  },
};

