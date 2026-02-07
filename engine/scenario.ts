import { createRngState, rngInt, rngPick } from "./rng";
import type { ActorId, ExternalActorState, RegimeType, WorldState } from "./types";
import { clamp100 } from "./math";
import { generateBriefingAndEvents } from "./turnStart";

type ScenarioTemplate = {
  regionLabel: string;
  countryNames: string[];
  geographySummary: string[];
  neighbors: string[][];
  regimeTypes: RegimeType[];
  regionalPowers: { id: ActorId; name: string }[];
  vulnerabilities: string[];
};

const scenarios: ScenarioTemplate[] = [
  {
    regionLabel: "Eastern Mediterranean",
    countryNames: ["Varosia", "Kalyra", "Lydria"],
    geographySummary: [
      "Mid-sized coastal state on a constrained sea-lane: dense urban coast, underdeveloped interior, and a single port that functions as a national choke point. Smuggling and port labor politics are persistent leverage points. Your margin for error is thin when shipping insurers get nervous.",
      "Bridge between maritime trade routes and an unstable hinterland; energy transit corridors nearby and rival intelligence services operate with long memories. Domestic politics is transactional and brittle under price shocks. Geography gives you leverage—until it becomes a trap.",
    ],
    neighbors: [
      ["Turkey", "Syria", "Greece"],
      ["Turkey", "Iraq", "Cyprus"],
    ],
    regimeTypes: ["hybrid", "authoritarian"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Turkey" },
      { id: "REGIONAL_2", name: "Iran" },
    ],
    vulnerabilities: [
      "High import dependence for refined fuels.",
      "Fragmented security services and politicized promotions.",
      "Minority-majority tension concentrated in two provinces.",
    ],
  },
  {
    regionLabel: "Southern Cone (South America)",
    countryNames: ["Rionegro", "Santeluz", "Puerto Azul"],
    geographySummary: [
      "River-and-ports republic with a temperate agricultural core and a concentrated capital; export earnings hinge on commodity prices and shipping access. The interior is productive but politically resentful of the capital. Monetary credibility is fragile; strikes at ports or rail chokepoints ripple fast.",
      "Mid-latitude coastal state with a narrow industrial belt and long supply lines; energy imports are a persistent vulnerability. A politicized central bank and a powerful trucking union set the tempo of domestic stability. External leverage often arrives through credit terms, not tanks.",
    ],
    neighbors: [
      ["Brazil", "Argentina", "Uruguay"],
      ["Chile", "Argentina", "Bolivia"],
    ],
    regimeTypes: ["democracy", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Brazil" },
      { id: "REGIONAL_2", name: "Argentina" },
    ],
    vulnerabilities: [
      "FX and external financing sensitivity; confidence shocks transmit quickly to prices.",
      "Port, rail, and fuel distribution chokepoints are strategic terrain for unions and rivals.",
      "Polarized politics; legitimacy can erode suddenly after austerity or corruption leaks.",
    ],
  },
  {
    regionLabel: "Central Asia",
    countryNames: ["Kharistan", "Orun", "Zeravan"],
    geographySummary: [
      "Landlocked steppe-and-mountain state with long borders and sparse settlement; logistics and border control are costly. Transit routes can be leverage or liability depending on sanctions and security guarantees. Elite politics is opaque, patronage-heavy, and vulnerable to succession anxiety.",
      "Resource-adjacent state with a single export corridor and a capital-dependent bureaucracy; informal networks often outcompete formal institutions. External actors compete through pipelines, rail, and intelligence relationships. Domestic stability depends on price control and security service cohesion.",
    ],
    neighbors: [
      ["Kazakhstan", "Uzbekistan", "Kyrgyzstan"],
      ["Uzbekistan", "Tajikistan", "Afghanistan"],
    ],
    regimeTypes: ["authoritarian", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Russia" },
      { id: "REGIONAL_2", name: "Turkey" },
    ],
    vulnerabilities: [
      "Single-corridor export dependence; transit disputes can become existential.",
      "Succession risk and factional security services; coups are plausible under stress.",
      "Border insecurity and smuggling networks undermine state revenue and legitimacy.",
    ],
  },
  {
    regionLabel: "South Asia",
    countryNames: ["Indara", "Kashmiron", "Suryan"],
    geographySummary: [
      "Densely populated state on a contested frontier; small incidents can scale into national crises under media pressure. Water and energy politics are inseparable from security. Urban supply chains are fragile; protests can become self-sustaining when fuel and food prices spike.",
      "Mountain-frontier polity with limited strategic depth and a security-heavy state; diaspora remittances stabilize budgets but create external exposure. Domestic cohesion depends on patronage and narrative control. Border skirmishes are as much political theater as military reality—until they aren't.",
    ],
    neighbors: [
      ["India", "Pakistan", "Bangladesh"],
      ["Pakistan", "Afghanistan", "India"],
    ],
    regimeTypes: ["hybrid", "democracy", "authoritarian"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "India" },
      { id: "REGIONAL_2", name: "Pakistan" },
    ],
    vulnerabilities: [
      "High sensitivity to fuel/food prices; unrest can spike with little warning.",
      "Border incidents are politically weaponized; escalation control is difficult.",
      "Institutional overload: courts, police, and bureaucracy are stretched and politicized.",
    ],
  },
  {
    regionLabel: "North Africa",
    countryNames: ["Maghraba", "Qasria", "Saharat"],
    geographySummary: [
      "Coastal-urban state with a vast desert hinterland; control weakens rapidly outside cities. Energy rents can buy time but also entrench corruption and elite rivalry. Migration, smuggling, and militia politics create constant low-grade coercion.",
      "Trade-facing state with a tight capital and contested periphery; tourism and shipping are lifelines that panic under security headlines. Security services are strong but fragmented. Foreign partners prefer stability but demand visible compliance on sanctions and border control.",
    ],
    neighbors: [
      ["Algeria", "Tunisia", "Libya"],
      ["Morocco", "Algeria", "Mauritania"],
    ],
    regimeTypes: ["authoritarian", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Egypt" },
      { id: "REGIONAL_2", name: "Algeria" },
    ],
    vulnerabilities: [
      "Security periphery: militia and smuggling networks can outpace the state.",
      "Tourism/shipping fragility; perception shocks hit revenue faster than policy can respond.",
      "Elite cohesion depends on rents; reforms can trigger backlash from insiders.",
    ],
  },
  {
    regionLabel: "Persian Gulf",
    countryNames: ["Al-Hadid", "Bahrun", "Qatirah"],
    geographySummary: [
      "Small, wealthy energy exporter with outsized media and finance influence; security depends on external guarantees and careful balancing. Shipping chokepoints nearby make every crisis international. Domestic stability is strong until legitimacy is questioned by succession or subsidy reforms.",
      "Coastal state with a concentrated infrastructure footprint; a handful of facilities are strategic single points of failure. Foreign basing and intelligence partnerships bring protection and exposure. Rival narratives target you because leverage is cheap and attention is high.",
    ],
    neighbors: [
      ["Saudi Arabia", "United Arab Emirates", "Iran"],
      ["Iraq", "Kuwait", "Saudi Arabia"],
    ],
    regimeTypes: ["authoritarian", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Saudi Arabia" },
      { id: "REGIONAL_2", name: "Iran" },
    ],
    vulnerabilities: [
      "Infrastructure concentration: a few facilities drive most revenue and coercive leverage.",
      "External security dependence; alliance politics can flip quickly under scandal or war.",
      "Information war exposure; narrative shocks can trigger capital flight or sanction scrutiny.",
    ],
  },
  {
    regionLabel: "Caucasus",
    countryNames: ["Ardzen", "Caspira", "Vardak"],
    geographySummary: [
      "Mountain corridor state between larger powers; transit and pipelines are leverage until they become targets. Frozen conflicts and displaced communities are permanent political tools. Domestic politics is sharp-edged; small concessions read as weakness.",
      "Compact state with a strategic pass and a contested border; security depends on rapid mobilization and patronage in the officer corps. External actors compete through arms deals and intelligence ties. Economic stability hinges on remittances and a single export route.",
    ],
    neighbors: [
      ["Georgia", "Armenia", "Azerbaijan"],
      ["Russia", "Georgia", "Turkey"],
    ],
    regimeTypes: ["hybrid", "authoritarian"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Russia" },
      { id: "REGIONAL_2", name: "Turkey" },
    ],
    vulnerabilities: [
      "Frozen conflict risk; escalation can be triggered by a single incident.",
      "Transit chokepoints: pipelines/rail are both revenue and coercion vectors.",
      "Elite politics are factional; security service rivalry can sabotage policy.",
    ],
  },
  {
    regionLabel: "Central America / Caribbean",
    countryNames: ["San Cielo", "Nueva Mar", "Isla Verdad"],
    geographySummary: [
      "Port-and-services state with high exposure to crime networks; security legitimacy hinges on visible order and predictable prices. Remittances and tourism are lifelines that panic under headlines. External pressure is often legal/financial rather than military.",
      "Small island state with concentrated infrastructure and a narrow tax base; hurricane logistics and fuel imports are strategic vulnerabilities. Political coalitions are fragile and transactional. A single corruption scandal can trigger mass street mobilization.",
    ],
    neighbors: [
      ["Mexico", "Guatemala", "Honduras"],
      ["Dominican Republic", "Haiti", "Puerto Rico"],
    ],
    regimeTypes: ["democracy", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Mexico" },
      { id: "REGIONAL_2", name: "Colombia" },
    ],
    vulnerabilities: [
      "Organized crime capture risk; coercion and corruption erode legitimacy together.",
      "Tourism/remittance dependence; shocks translate quickly into unrest.",
      "External legal/financial pressure can be decisive (sanctions, banking access).",
    ],
  },
  {
    regionLabel: "East Africa (Great Lakes)",
    countryNames: ["Kivura", "Nyando", "Rutana"],
    geographySummary: [
      "Highland state with dense population pockets and contested borderlands; armed groups exploit cross-border sanctuaries and local grievances. Mining and customs revenue is politicized. Security operations are costly and can backfire into legitimacy loss.",
      "Lakeside trade hub with a crowded capital and weak peripheral governance; refugee flows and militia logistics are persistent constraints. External actors operate through training missions and quiet deals. Domestic cohesion depends on elite bargaining more than ideology.",
    ],
    neighbors: [
      ["Uganda", "Rwanda", "DRC"],
      ["Kenya", "Uganda", "Tanzania"],
    ],
    regimeTypes: ["authoritarian", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Kenya" },
      { id: "REGIONAL_2", name: "Ethiopia" },
    ],
    vulnerabilities: [
      "Border militia dynamics; security operations can generate insurgency blowback.",
      "Customs/mining revenue capture; elite cohesion is rent-dependent.",
      "Refugee and humanitarian pressure creates international scrutiny and leverage.",
    ],
  },
  {
    regionLabel: "Western Pacific (island chain)",
    countryNames: ["Pelagia", "Atarua", "Namos"],
    geographySummary: [
      "Small maritime state spread across islands; sovereignty is measured in patrol capacity and port access. Great-power competition arrives through basing offers, telecom deals, and disaster relief. Domestic politics is local and relational, but external stakes are strategic.",
      "Remote archipelago with fragile infrastructure; fuel and food import dependence is near-total. The capital is exposed to storms and supply disruptions. Foreign investment can stabilize budgets or become a sovereignty trap.",
    ],
    neighbors: [
      ["Philippines", "Papua New Guinea", "Australia"],
      ["Japan", "Taiwan", "Philippines"],
    ],
    regimeTypes: ["democracy", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Australia" },
      { id: "REGIONAL_2", name: "Japan" },
    ],
    vulnerabilities: [
      "Import dependence; supply shocks translate immediately into legitimacy stress.",
      "Basing/telecom influence operations; sovereignty can be traded away quietly.",
      "Disaster logistics exposure; one storm can dominate the political calendar.",
    ],
  },
  {
    regionLabel: "Eastern Europe",
    countryNames: ["Drevnia", "Karsovia", "Belograd"],
    geographySummary: [
      "Landlocked border state on a friction line between blocs: flat approaches, exposed supply routes, and a capital within easy reach of mechanized forces. Your strategic depth is limited. Deterrence is more about signaling and logistics than heroics.",
      "Industrial legacy with aging infrastructure and a politically active diaspora; remittances and EU access can stabilize—or become conditional leverage. Border narratives spread fast, and small incidents scale quickly. Domestic tolerance for prolonged hardship is low.",
    ],
    neighbors: [
      ["Poland", "Ukraine", "Romania"],
      ["Ukraine", "Belarus", "Hungary"],
    ],
    regimeTypes: ["democracy", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Poland" },
      { id: "REGIONAL_2", name: "Ukraine" },
    ],
    vulnerabilities: [
      "Energy supply vulnerability to external pricing and sabotage.",
      "Border incidents can trigger alliance chain reactions.",
      "Low tolerance for casualties; protests escalate fast.",
    ],
  },
  {
    regionLabel: "West Africa (Sahel fringe)",
    countryNames: ["Sahelia", "Kombara", "Tessit"],
    geographySummary: [
      "Semi-arid state with porous borders and vast terrain: internal security is stretched, and state presence thins rapidly outside cities. Armed groups exploit distance, not ideology. Control is negotiated as much as enforced.",
      "Commodity exporter with weak institutions and strong patronage networks; revenue is volatile and loyalties are rented. Foreign security assistance comes with strings. A single bad harvest or currency shock can rewire domestic politics.",
    ],
    neighbors: [
      ["Mali", "Niger", "Burkina Faso"],
      ["Niger", "Chad", "Nigeria"],
    ],
    regimeTypes: ["authoritarian", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Nigeria" },
      { id: "REGIONAL_2", name: "Algeria" },
    ],
    vulnerabilities: [
      "Insurgent safe havens across the border.",
      "Elite cohesion depends on control of customs revenue.",
      "Currency weakness amplifies food-price shocks.",
    ],
  },
  {
    regionLabel: "Southeast Asia",
    countryNames: ["Sundara", "Meratai", "Kepura"],
    geographySummary: [
      "Archipelagic state astride a critical shipping route: maritime disputes nearby and a navy that must cover too much water with too few hulls. Sea-lane stability is your lifeline and your vulnerability. A single incident can pull major powers into your weather.",
      "Manufacturing base vulnerable to supply-chain disruption and capital flight; investors react to perception, not just fundamentals. Ports, customs, and shipping insurers are strategic terrain. Domestic narratives swing quickly when export orders stall.",
    ],
    neighbors: [
      ["Malaysia", "Indonesia", "Philippines"],
      ["Vietnam", "China", "Thailand"],
    ],
    regimeTypes: ["democracy", "hybrid"],
    regionalPowers: [
      { id: "REGIONAL_1", name: "Vietnam" },
      { id: "REGIONAL_2", name: "Japan" },
    ],
    vulnerabilities: [
      "Sensitive to sanctions on dual-use tech imports.",
      "Maritime incident risk; escalation is hard to control.",
      "Media ecosystem is fragmented; rumors spread quickly.",
    ],
  },
];

function baseActor(id: ActorId, name: string): ExternalActorState {
  return {
    id,
    name,
    objectives: [],
    redLines: [],
    riskTolerance: 50,
    domesticPressure: 40,
    postureTowardPlayer: "neutral",
    trust: 50,
    willingnessToEscalate: 40,
    sanctionsPolicyStrength: 50,
    allianceCommitmentStrength: 50,
  };
}

function buildActors(template: ScenarioTemplate): Record<ActorId, ExternalActorState> {
  const US = baseActor("US", "United States");
  US.objectives = [
    { text: "Preserve alliance credibility and sea-lane stability", weight: 0.7 },
    { text: "Deter aggression and prevent regional spillover", weight: 0.6 },
    { text: "Maintain leverage via sanctions and financial access", weight: 0.5 },
  ];
  US.redLines = ["Direct attack on allied forces", "WMD proliferation signals", "Mass civilian atrocities"];
  US.riskTolerance = 55;
  US.sanctionsPolicyStrength = 70;
  US.allianceCommitmentStrength = 75;

  const CHINA = baseActor("CHINA", "China");
  CHINA.objectives = [
    { text: "Expand market access and infrastructure influence", weight: 0.7 },
    { text: "Avoid precedent for external intervention", weight: 0.5 },
    { text: "Protect supply chains and energy security", weight: 0.6 },
  ];
  CHINA.redLines = ["Threats to Chinese nationals/assets", "Formal alignment against China"];
  CHINA.riskTolerance = 45;
  CHINA.sanctionsPolicyStrength = 35;

  const RUSSIA = baseActor("RUSSIA", "Russia");
  RUSSIA.objectives = [
    { text: "Disrupt Western cohesion and gain leverage", weight: 0.7 },
    { text: "Secure military access and arms markets", weight: 0.6 },
  ];
  RUSSIA.redLines = ["Hostile basing near Russian interests", "Severe sanction expansion via player cooperation"];
  RUSSIA.riskTolerance = 60;
  RUSSIA.willingnessToEscalate = 60;

  const EU = baseActor("EU", "European Union");
  EU.objectives = [
    { text: "Prevent refugee flows and energy shocks", weight: 0.7 },
    { text: "Maintain legal norms and sanctions consistency", weight: 0.6 },
  ];
  EU.redLines = ["Mass repression", "Energy blackmail", "Attack on EU-linked infrastructure"];
  EU.riskTolerance = 40;
  EU.sanctionsPolicyStrength = 65;
  EU.allianceCommitmentStrength = 70;

  const regional1 = baseActor(template.regionalPowers[0].id, template.regionalPowers[0].name);
  regional1.objectives = [
    { text: "Shape the local balance of power and border outcomes", weight: 0.7 },
    { text: "Avoid instability that spills over domestically", weight: 0.6 },
  ];
  regional1.redLines = ["Cross-border insurgent sanctuaries", "Attack on border forces"];
  regional1.riskTolerance = 55;
  regional1.willingnessToEscalate = 50;

  const regional2 = baseActor(template.regionalPowers[1].id, template.regionalPowers[1].name);
  regional2.objectives = [
    { text: "Secure influence through trade, energy, and security ties", weight: 0.7 },
    { text: "Prevent hostile alignment on its flank", weight: 0.5 },
  ];
  regional2.redLines = ["Foreign basing and intelligence hubs", "Direct strikes on core territory"];
  regional2.riskTolerance = 50;
  regional2.willingnessToEscalate = 45;

  return { US, CHINA, RUSSIA, EU, REGIONAL_1: regional1, REGIONAL_2: regional2 };
}

export function createInitialWorld(seed: string): WorldState {
  const rng = createRngState(seed);
  const scenario = rngPick(rng, scenarios);

  const name = rngPick(rng, scenario.countryNames);
  const geographySummary = rngPick(rng, scenario.geographySummary);
  const neighbors = rngPick(rng, scenario.neighbors);
  const regimeType = rngPick(rng, scenario.regimeTypes);
  const actors = buildActors(scenario);

  // A grounded starting point: not apocalyptic, but pressured.
  const oilGas = rngInt(rng, 20, 75);
  const industrialBase = rngInt(rng, 30, 70);
  const food = rngInt(rng, 35, 80);
  const rareEarths = rngInt(rng, 10, 60);

  const debtStress = rngInt(rng, 35, 75);
  const inflationPressure = rngInt(rng, 25, 65);
  const unemployment = rngInt(rng, 20, 55);
  const economicStability = clamp100(70 - 0.35 * debtStress - 0.25 * inflationPressure + rngInt(rng, -6, 6));

  const intelligenceServices = rngInt(rng, 35, 75);
  const mediaControl = regimeType === "democracy" ? rngInt(rng, 20, 45) : rngInt(rng, 45, 80);
  const corruption = rngInt(rng, 35, 75);

  const legitimacy = clamp100(rngInt(rng, 45, 70) - (corruption - 50) * 0.25 - (debtStress - 50) * 0.15);
  const eliteCohesion = clamp100(rngInt(rng, 45, 75) - (corruption - 50) * 0.2);
  const militaryLoyalty = clamp100(rngInt(rng, 45, 80) - (legitimacy < 50 ? 6 : 0));
  const publicApproval = clamp100(rngInt(rng, 40, 70) - (inflationPressure - 50) * 0.2);
  const unrest = clamp100(25 + (50 - legitimacy) * 0.4 + (inflationPressure - 40) * 0.25 + rngInt(rng, -6, 6));

  const sovereigntyIntegrity = clamp100(rngInt(rng, 75, 92) - rngInt(rng, 0, 8));
  const credibilityGlobal = clamp100(rngInt(rng, 45, 70));

  // Set initial external pressure: one or two major actors start skeptical/hostile depending on scenario.
  const pressureActor: ActorId = rngPick(rng, ["US", "RUSSIA", "CHINA", "EU"]);
  actors[pressureActor].postureTowardPlayer = "hostile";
  actors[pressureActor].trust = clamp100(actors[pressureActor].trust - rngInt(rng, 10, 25));
  actors[pressureActor].domesticPressure = clamp100(actors[pressureActor].domesticPressure + rngInt(rng, 10, 25));

  const world: WorldState = {
    version: 1,
    rng,
    turn: 1,
    player: {
      name,
      geographySummary,
      neighbors,
      regimeType,
      populationM: rngInt(rng, 12, 55),
      demographicsTags: rngPick(rng, [
        ["urban_youth_bulge", "regional_identity_politics"],
        ["aging_industrial_workforce", "diaspora_influence"],
        ["multiethnic_compact", "borderland_clans"],
        ["high_education_islands", "rural_poverty_pockets"],
      ]),
      resources: { oilGas, rareEarths, food, industrialBase },
      economy: {
        gdpIndex: clamp200(60 + industrialBase * 0.6 + oilGas * 0.25 + rngInt(rng, -8, 8)),
        economicStability,
        inflationPressure,
        unemployment,
        debtStress,
      },
      military: {
        manpower: clamp100(rngInt(rng, 35, 80)),
        readiness: clamp100(rngInt(rng, 35, 70)),
        logistics: clamp100(rngInt(rng, 30, 70)),
        techLevel: clamp100(rngInt(rng, 30, 65)),
        airDefense: clamp100(rngInt(rng, 25, 70)),
        cyber: clamp100(rngInt(rng, 30, 70)),
      },
      tensions: {
        ethnic: clamp100(rngInt(rng, 25, 75)),
        ideological: clamp100(rngInt(rng, 25, 75)),
        regional: clamp100(rngInt(rng, 25, 75)),
      },
      institutions: {
        courts: clamp100(rngInt(rng, 30, 70)),
        parliament: clamp100(regimeType === "democracy" ? rngInt(rng, 50, 80) : rngInt(rng, 25, 60)),
        intelligenceServices,
      },
      politics: {
        legitimacy,
        eliteCohesion,
        militaryLoyalty,
        publicApproval,
        mediaControl,
        corruption,
        warSupport: clamp100(rngInt(rng, 35, 65)),
        unrest,
        sovereigntyIntegrity,
        credibilityGlobal,
        credibilityByActor: {
          US: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
          CHINA: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
          RUSSIA: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
          EU: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
          REGIONAL_1: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
          REGIONAL_2: clamp100(credibilityGlobal + rngInt(rng, -15, 15)),
        },
      },
      flags: { puppet: false, capitalOccupied: false },
    },
    actors,
    global: {
      globalTradeTemperature: clamp100(rngInt(rng, 45, 70) - (worldTightnessHint(industrialBase) ? 5 : 0)),
      globalEnergyMarketTightness: clamp100(rngInt(rng, 45, 75)),
      attentionLevel: clamp100(rngInt(rng, 30, 55) + (actors[pressureActor].postureTowardPlayer === "hostile" ? 8 : 0)),
      sanctionsRegimeActive: false,
      allianceEdges: [
        { a: "US", b: "EU", strength: 85 },
        { a: "US", b: "REGIONAL_1", strength: 55 },
        { a: "EU", b: "REGIONAL_1", strength: 45 },
        { a: "CHINA", b: "RUSSIA", strength: 55 },
      ],
    },
    conflicts: [],
    scheduled: [],
    current: {
      // Populated immediately below.
      briefing: { text: "", headlines: [], domesticRumors: [], diplomaticMessages: [], intelBriefs: [] },
      incomingEvents: [],
    },
  };

  // Generate the initial briefing + incoming events (Turn 1 must contain a credible pressure event).
  const { briefing, events } = generateBriefingAndEvents(world, { forcePressureEvent: true });
  world.current.briefing = briefing;
  world.current.incomingEvents = events;

  return world;
}

function worldTightnessHint(industrialBase: number): boolean {
  return industrialBase > 60;
}

function clamp200(n: number): number {
  return Math.max(0, Math.min(200, Math.round(n)));
}

