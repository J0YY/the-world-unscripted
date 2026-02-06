import type { FailureDetails, FailureType, WorldState } from "./types";

export function detectFailure(world: WorldState): FailureDetails | undefined {
  const p = world.player;

  // Loss of sovereignty (hard stop).
  if (p.flags.capitalOccupied || p.flags.puppet || p.politics.sovereigntyIntegrity <= 20) {
    const drivers = [
      p.flags.capitalOccupied ? "Capital effectively controlled by external force" : "Operational autonomy no longer credible",
      `Sovereignty integrity collapsed (${p.politics.sovereigntyIntegrity}/100)`,
      world.conflicts.length > 0 ? "Conflict escalation outpaced logistics and alliances" : "External leverage converted into control",
    ];
    return mkFailure("LOSS_OF_SOVEREIGNTY", drivers);
  }

  // Domestic ouster.
  const legitimacyLow = p.politics.legitimacy <= 24;
  const eliteLow = p.politics.eliteCohesion <= 34;
  const militaryLow = p.politics.militaryLoyalty <= 34;
  const unrestHigh = p.politics.unrest >= 72;

  const ouster = legitimacyLow && (eliteLow || militaryLow || unrestHigh);
  const revolutionary = p.politics.unrest >= 88 && p.politics.mediaControl <= 40;

  if (ouster || revolutionary) {
    const drivers: string[] = [];
    drivers.push(`Legitimacy collapsed (${p.politics.legitimacy}/100)`);
    if (eliteLow) drivers.push(`Elite cohesion fractured (${p.politics.eliteCohesion}/100)`);
    if (militaryLow) drivers.push(`Military loyalty failed (${p.politics.militaryLoyalty}/100)`);
    if (unrestHigh) drivers.push(`Unrest became uncontrollable (${p.politics.unrest}/100)`);
    if (p.economy.inflationPressure >= 65) drivers.push("Inflation pressure drove unrest and elite defection");
    return mkFailure("DOMESTIC_OUSTER", drivers.slice(0, 3));
  }

  return undefined;
}

function mkFailure(type: FailureType, primaryDrivers: string[]): FailureDetails {
  const title = type === "DOMESTIC_OUSTER" ? "Domestic ouster" : "Loss of sovereignty";
  return {
    type,
    title,
    primaryDrivers,
    pointOfNoReturnGuess:
      type === "DOMESTIC_OUSTER"
        ? "When legitimacy fell below ~35 and the security elite stopped coordinating."
        : "When sovereignty integrity fell below ~40 and external actors began treating you as a managed problem.",
    lastTurns: [],
  };
}

