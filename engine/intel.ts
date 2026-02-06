import { rngChance, rngNormalApprox } from "./rng";
import type { Confidence, ObservedMetric, WorldState } from "./types";
import { clamp100, clamp01 } from "./math";

function warFogFactor(world: WorldState): number {
  if (world.conflicts.length === 0) return 0;
  const avgIntensity =
    world.conflicts.reduce((acc, c) => acc + c.fronts.reduce((a, f) => a + f.intensity, 0), 0) /
    Math.max(1, world.conflicts.reduce((acc, c) => acc + c.fronts.length, 0));
  return clamp01(avgIntensity / 100);
}

function deceptionPressure(world: WorldState): number {
  const hostileActors = Object.values(world.actors).filter((a) => a.postureTowardPlayer === "hostile");
  if (hostileActors.length === 0) return 0;
  const avg =
    hostileActors.reduce((acc, a) => acc + (a.willingnessToEscalate + (100 - a.trust)) / 2, 0) /
    hostileActors.length;
  // Higher global attention tends to amplify deception activity.
  return clamp01((avg / 100) * (0.4 + 0.6 * (world.global.attentionLevel / 100)));
}

export function intelQuality01(world: WorldState): number {
  const intel = world.player.institutions.intelligenceServices / 100;
  const media = world.player.politics.mediaControl / 100;
  const fog = warFogFactor(world);
  const deception = deceptionPressure(world);

  // Intel services and media control help you collect and shape signal; war fog and deception degrade it.
  const raw = 0.25 + 0.5 * intel + 0.15 * media - 0.35 * fog - 0.25 * deception;
  return clamp01(raw);
}

function confidenceFromSigma(sigma: number): Confidence {
  if (sigma <= 4) return "high";
  if (sigma <= 9) return "med";
  return "low";
}

export function observeMetric(
  world: WorldState,
  trueValue: number,
  opts: {
    /** Typical metric range width used to scale noise (e.g. 0-100 metrics use 100) */
    scale: number;
    drivers: string[];
    /** If present, treat as more uncertain (e.g. fog-of-war indicators). */
    extraUncertainty?: number; // 0..1
  },
): ObservedMetric {
  const q = intelQuality01(world);
  const fog = warFogFactor(world);
  const deception = deceptionPressure(world);
  const extra = clamp01(opts.extraUncertainty ?? 0);

  // Sigma is larger when intel is worse, fog is higher, or deception is active.
  const sigma =
    opts.scale *
    (0.04 +
      0.12 * (1 - q) +
      0.08 * fog +
      0.06 * deception +
      0.06 * extra);

  const noise = rngNormalApprox(world.rng) * sigma;
  let estimatedValue = trueValue + noise;

  // Rare gross misreads: false positives/negatives under low intel and high deception.
  const grossMisreadP = clamp01(0.03 + 0.12 * (1 - q) * deception);
  if (rngChance(world.rng, grossMisreadP)) {
    estimatedValue += rngNormalApprox(world.rng) * opts.scale * 0.18;
  }

  estimatedValue = clamp100(estimatedValue);

  // Confidence is primarily a function of sigma but can be nudged by "credible" but wrong narratives.
  let confidence = confidenceFromSigma(sigma);
  if (rngChance(world.rng, 0.08 * (1 - q) + 0.05 * deception)) {
    // Occasionally your system is overconfident.
    confidence = confidence === "low" ? "med" : "high";
  }

  return {
    estimatedValue: Math.round(estimatedValue),
    confidence,
    knownDrivers: opts.drivers,
  };
}

