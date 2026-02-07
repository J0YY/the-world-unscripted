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
    "AT": { lat: 47.52, lon: 14.55 },
    "CH": { lat: 46.82, lon: 8.23 },
    "GR": { lat: 39.07, lon: 21.82 },
    "PT": { lat: 39.40, lon: -8.22 },
    "CZ": { lat: 49.82, lon: 15.47 },
    "RO": { lat: 45.94, lon: 24.97 },
    "HU": { lat: 47.16, lon: 19.50 },
    "BG": { lat: 42.73, lon: 25.49 },
    "SK": { lat: 48.67, lon: 19.70 },
    "DK": { lat: 56.26, lon: 9.50 },
    "FI": { lat: 61.92, lon: 25.75 },
    "IE": { lat: 53.41, lon: -8.24 },
    "HR": { lat: 45.10, lon: 15.20 },
    "RS": { lat: 44.02, lon: 21.01 },
    "LT": { lat: 55.17, lon: 23.88 },
    "LV": { lat: 56.88, lon: 24.60 },
    "EE": { lat: 58.60, lon: 25.01 },
    "SI": { lat: 46.15, lon: 14.99 },
    "BY": { lat: 53.71, lon: 27.95 },
    "AL": { lat: 41.15, lon: 20.17 },
    "MK": { lat: 41.61, lon: 21.75 },
    "BA": { lat: 43.92, lon: 17.68 },
    "ME": { lat: 42.71, lon: 19.37 },
    "MD": { lat: 47.41, lon: 28.37 },
    "IS": { lat: 64.96, lon: -19.02 },
    "LU": { lat: 49.82, lon: 6.13 },
    
    // Americas
    "US": { lat: 37.09, lon: -95.71 },
    "CA": { lat: 56.13, lon: -106.35 },
    "MX": { lat: 23.63, lon: -102.55 },
    "BR": { lat: -14.24, lon: -51.93 },
    "AR": { lat: -38.42, lon: -63.62 },
    "CL": { lat: -35.67, lon: -71.54 },
    "CO": { lat: 4.57, lon: -74.30 },
    "VE": { lat: 6.42, lon: -66.59 },
    "PE": { lat: -9.19, lon: -75.02 },
    "EC": { lat: -1.83, lon: -78.18 },
    "BO": { lat: -16.29, lon: -63.59 },
    "PY": { lat: -23.44, lon: -58.44 },
    "UY": { lat: -32.52, lon: -55.77 },
    "GY": { lat: 4.86, lon: -58.93 },
    "SR": { lat: 3.92, lon: -56.03 },
    "GF": { lat: 3.93, lon: -53.13 },
    "CR": { lat: 9.75, lon: -83.75 },
    "PA": { lat: 8.54, lon: -80.78 },
    "GT": { lat: 15.78, lon: -90.23 },
    "HN": { lat: 15.20, lon: -86.24 },
    "NI": { lat: 12.87, lon: -85.21 },
    "SV": { lat: 13.79, lon: -88.90 },
    "BZ": { lat: 17.19, lon: -88.50 },
    "CU": { lat: 21.52, lon: -77.78 },
    "DO": { lat: 18.74, lon: -70.16 },
    "HT": { lat: 18.97, lon: -72.29 },
    "JM": { lat: 18.11, lon: -77.30 },
    "TT": { lat: 10.69, lon: -61.22 },
    
    // Asia
    "CN": { lat: 35.86, lon: 104.20 },
    "IN": { lat: 20.59, lon: 78.96 },
    "JP": { lat: 36.20, lon: 138.25 },
    "KR": { lat: 35.91, lon: 127.77 },
    "KP": { lat: 40.34, lon: 127.51 },
    "ID": { lat: -0.79, lon: 113.92 },
    "TH": { lat: 15.87, lon: 100.99 },
    "VN": { lat: 14.06, lon: 108.28 },
    "PK": { lat: 30.37, lon: 69.35 },
    "SG": { lat: 1.35, lon: 103.82 },
    "MY": { lat: 4.21, lon: 101.69 },
    "PH": { lat: 12.88, lon: 121.77 },
    "BD": { lat: 23.68, lon: 90.36 },
    "MM": { lat: 21.91, lon: 95.96 },
    "KH": { lat: 12.57, lon: 104.99 },
    "LA": { lat: 19.86, lon: 102.50 },
    "NP": { lat: 28.39, lon: 84.12 },
    "LK": { lat: 7.87, lon: 80.77 },
    "AF": { lat: 33.94, lon: 67.71 },
    "KZ": { lat: 48.02, lon: 66.92 },
    "UZ": { lat: 41.38, lon: 64.59 },
    "TM": { lat: 38.97, lon: 59.56 },
    "KG": { lat: 41.20, lon: 74.77 },
    "TJ": { lat: 38.86, lon: 71.28 },
    "MN": { lat: 46.86, lon: 103.85 },
    "TW": { lat: 23.70, lon: 120.96 },
    "BT": { lat: 27.51, lon: 90.43 },
    "BN": { lat: 4.54, lon: 114.73 },
    "TL": { lat: -8.87, lon: 125.73 },
    
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
    "SY": { lat: 34.80, lon: 38.99 },
    "YE": { lat: 15.55, lon: 48.52 },
    "OM": { lat: 21.51, lon: 55.92 },
    "QA": { lat: 25.35, lon: 51.18 },
    "BH": { lat: 26.07, lon: 50.56 },
    "PS": { lat: 31.95, lon: 35.23 },
    "AM": { lat: 40.07, lon: 45.04 },
    "AZ": { lat: 40.14, lon: 47.58 },
    "GE": { lat: 42.32, lon: 43.36 },
    "CY": { lat: 35.13, lon: 33.43 },
    
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
    "DZ": { lat: 28.03, lon: 1.66 },
    "LY": { lat: 26.34, lon: 17.23 },
    "SD": { lat: 12.86, lon: 30.22 },
    "SS": { lat: 6.88, lon: 31.31 },
    "SO": { lat: 5.15, lon: 46.20 },
    "TZ": { lat: -6.37, lon: 34.89 },
    "MZ": { lat: -18.67, lon: 35.53 },
    "ZW": { lat: -19.02, lon: 29.15 },
    "BW": { lat: -22.33, lon: 24.68 },
    "NA": { lat: -22.96, lon: 18.49 },
    "ZM": { lat: -13.13, lon: 27.85 },
    "MW": { lat: -13.25, lon: 34.30 },
    "MG": { lat: -18.77, lon: 46.87 },
    "CM": { lat: 7.37, lon: 12.35 },
    "CI": { lat: 7.54, lon: -5.55 },
    "NE": { lat: 17.61, lon: 8.08 },
    "BF": { lat: 12.24, lon: -1.56 },
    "TD": { lat: 15.45, lon: 18.73 },
    "CF": { lat: 6.61, lon: 20.94 },
    "CG": { lat: -0.23, lon: 15.83 },
    "GA": { lat: -0.80, lon: 11.61 },
    "GQ": { lat: 1.65, lon: 10.27 },
    "RW": { lat: -1.94, lon: 29.87 },
    "BI": { lat: -3.37, lon: 29.92 },
    "DJ": { lat: 11.83, lon: 42.59 },
    "ER": { lat: 15.18, lon: 39.78 },
    "BJ": { lat: 9.31, lon: 2.32 },
    "TG": { lat: 8.62, lon: 0.82 },
    "SL": { lat: 8.46, lon: -11.78 },
    "LR": { lat: 6.43, lon: -9.43 },
    "MR": { lat: 21.01, lon: -10.94 },
    "GM": { lat: 13.44, lon: -15.31 },
    "GN": { lat: 9.95, lon: -9.70 },
    "GW": { lat: 11.80, lon: -15.18 },
    "LS": { lat: -29.61, lon: 28.23 },
    "SZ": { lat: -26.52, lon: 31.47 },
    
    // Oceania
    "AU": { lat: -25.27, lon: 133.78 },
    "NZ": { lat: -40.90, lon: 174.89 },
    "PG": { lat: -6.31, lon: 143.96 },
    "FJ": { lat: -17.71, lon: 178.07 },
    "SB": { lat: -9.65, lon: 160.16 },
    "VU": { lat: -15.38, lon: 166.96 },
    "NC": { lat: -20.90, lon: 165.62 },
    "WS": { lat: -13.76, lon: -172.10 },
  };

  const normalizeCountryName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const countryNameToCode: Record<string, string> = {
    // Europe
    "germany": "DE",
    "france": "FR",
    "united kingdom": "GB",
    "uk": "GB",
    "britain": "GB",
    "great britain": "GB",
    "england": "GB",
    "russia": "RU",
    "russian federation": "RU",
    "ukraine": "UA",
    "poland": "PL",
    "italy": "IT",
    "spain": "ES",
    "sweden": "SE",
    "norway": "NO",
    "belgium": "BE",
    "netherlands": "NL",
    "holland": "NL",
    "austria": "AT",
    "switzerland": "CH",
    "greece": "GR",
    "portugal": "PT",
    "czech republic": "CZ",
    "czechia": "CZ",
    "romania": "RO",
    "hungary": "HU",
    "bulgaria": "BG",
    "slovakia": "SK",
    "denmark": "DK",
    "finland": "FI",
    "ireland": "IE",
    "croatia": "HR",
    "serbia": "RS",
    "lithuania": "LT",
    "latvia": "LV",
    "estonia": "EE",
    "slovenia": "SI",
    "belarus": "BY",
    "albania": "AL",
    "north macedonia": "MK",
    "macedonia": "MK",
    "bosnia and herzegovina": "BA",
    "bosnia": "BA",
    "montenegro": "ME",
    "moldova": "MD",
    "republic of moldova": "MD",
    "iceland": "IS",
    "luxembourg": "LU",

    // Americas
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
    "america": "US",
    "canada": "CA",
    "mexico": "MX",
    "brazil": "BR",
    "argentina": "AR",
    "chile": "CL",
    "colombia": "CO",
    "venezuela": "VE",
    "peru": "PE",
    "ecuador": "EC",
    "bolivia": "BO",
    "paraguay": "PY",
    "uruguay": "UY",
    "guyana": "GY",
    "suriname": "SR",
    "french guiana": "GF",
    "costa rica": "CR",
    "panama": "PA",
    "guatemala": "GT",
    "honduras": "HN",
    "nicaragua": "NI",
    "el salvador": "SV",
    "belize": "BZ",
    "cuba": "CU",
    "dominican republic": "DO",
    "haiti": "HT",
    "jamaica": "JM",
    "trinidad and tobago": "TT",
    "trinidad": "TT",

    // Asia
    "china": "CN",
    "people s republic of china": "CN",
    "prc": "CN",
    "india": "IN",
    "japan": "JP",
    "south korea": "KR",
    "republic of korea": "KR",
    "korea": "KR",
    "north korea": "KP",
    "democratic people s republic of korea": "KP",
    "dprk": "KP",
    "indonesia": "ID",
    "thailand": "TH",
    "vietnam": "VN",
    "viet nam": "VN",
    "pakistan": "PK",
    "singapore": "SG",
    "malaysia": "MY",
    "philippines": "PH",
    "bangladesh": "BD",
    "myanmar": "MM",
    "burma": "MM",
    "cambodia": "KH",
    "laos": "LA",
    "nepal": "NP",
    "sri lanka": "LK",
    "afghanistan": "AF",
    "kazakhstan": "KZ",
    "uzbekistan": "UZ",
    "turkmenistan": "TM",
    "kyrgyzstan": "KG",
    "tajikistan": "TJ",
    "mongolia": "MN",
    "taiwan": "TW",
    "republic of china": "TW",
    "bhutan": "BT",
    "brunei": "BN",
    "timor leste": "TL",
    "east timor": "TL",

    // Middle East
    "saudi arabia": "SA",
    "uae": "AE",
    "united arab emirates": "AE",
    "emirates": "AE",
    "iran": "IR",
    "persia": "IR",
    "iraq": "IQ",
    "israel": "IL",
    "egypt": "EG",
    "turkey": "TR",
    "turkiye": "TR",
    "kuwait": "KW",
    "jordan": "JO",
    "lebanon": "LB",
    "syria": "SY",
    "syrian arab republic": "SY",
    "yemen": "YE",
    "oman": "OM",
    "qatar": "QA",
    "bahrain": "BH",
    "palestine": "PS",
    "state of palestine": "PS",
    "armenia": "AM",
    "azerbaijan": "AZ",
    "georgia": "GE",
    "cyprus": "CY",

    // Africa
    "south africa": "ZA",
    "nigeria": "NG",
    "ethiopia": "ET",
    "kenya": "KE",
    "morocco": "MA",
    "tunisia": "TN",
    "uganda": "UG",
    "ghana": "GH",
    "mali": "ML",
    "democratic republic of the congo": "CD",
    "dr congo": "CD",
    "congo kinshasa": "CD",
    "drc": "CD",
    "angola": "AO",
    "senegal": "SN",
    "algeria": "DZ",
    "libya": "LY",
    "sudan": "SD",
    "south sudan": "SS",
    "somalia": "SO",
    "tanzania": "TZ",
    "mozambique": "MZ",
    "zimbabwe": "ZW",
    "botswana": "BW",
    "namibia": "NA",
    "zambia": "ZM",
    "malawi": "MW",
    "madagascar": "MG",
    "cameroon": "CM",
    "cote d ivoire": "CI",
    "ivory coast": "CI",
    "niger": "NE",
    "burkina faso": "BF",
    "chad": "TD",
    "central african republic": "CF",
    "car": "CF",
    "republic of the congo": "CG",
    "congo brazzaville": "CG",
    "gabon": "GA",
    "equatorial guinea": "GQ",
    "rwanda": "RW",
    "burundi": "BI",
    "djibouti": "DJ",
    "eritrea": "ER",
    "benin": "BJ",
    "togo": "TG",
    "sierra leone": "SL",
    "liberia": "LR",
    "mauritania": "MR",
    "gambia": "GM",
    "guinea": "GN",
    "guinea bissau": "GW",
    "lesotho": "LS",
    "eswatini": "SZ",
    "swaziland": "SZ",

    // Oceania
    "australia": "AU",
    "new zealand": "NZ",
    "papua new guinea": "PG",
    "png": "PG",
    "fiji": "FJ",
    "solomon islands": "SB",
    "vanuatu": "VU",
    "new caledonia": "NC",
    "samoa": "WS",
  };

  const resolveCountryCode = (name: string) => {
    const trimmed = name.trim();
    if (trimmed.length === 2 && countryLocationMap[trimmed.toUpperCase()]) return trimmed.toUpperCase();
    return countryNameToCode[normalizeCountryName(trimmed)] ?? null;
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

  // If the player's country is fictional, infer its approximate location
  // from its listed neighbors and add a special marker so the map can
  // highlight pixels near that inferred point (client will look for
  // a countryCode of "__PLAYER__").
  // This ALWAYS runs in relationship mode, independent of relationshipIndex.
  if (mode === "relationship") {
    const neighbors = snapshot.countryProfile.neighbors || [];
    const neighborCodes = neighbors.map((n) => resolveCountryCode(n)).filter(Boolean) as string[];
    const locs = neighborCodes.map((code) => countryLocationMap[code]).filter(Boolean) as { lat: number; lon: number }[];
    if (locs.length > 0) {
      const avg = locs.reduce((acc, cur) => ({ lat: acc.lat + cur.lat, lon: acc.lon + cur.lon }), { lat: 0, lon: 0 });
      const lat = avg.lat / locs.length;
      const lon = avg.lon / locs.length;
      colors.push({
        countryCode: "__PLAYER__",
        lat,
        lon,
        intensity: "high",
        color: "#ff66b2",
      });
    }
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

