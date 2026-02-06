import type { EffectOp, IncomingEvent, PlayerAction, WorldState } from "./types";
import { clamp100 } from "./math";
import { rngChance, rngInt, rngPick } from "./rng";

export type ResolutionBundle = {
  publicTextBlocks: string[];
  publicConsequences: string[];
  hiddenOps: EffectOp[];
  publicOps: EffectOp[];
  scheduled: WorldState["scheduled"];
  signalsUnknown: string[];
};

export function resolveIncomingEvents(world: WorldState, events: IncomingEvent[]): ResolutionBundle {
  const publicConsequences: string[] = [];
  const publicOps: EffectOp[] = [];
  const hiddenOps: EffectOp[] = [];
  const scheduled = [...world.scheduled];

  for (const e of events) {
    for (const op of e.hiddenPayload.effects) {
      (op.visibility === "public" ? publicOps : hiddenOps).push(op);
    }
    if (e.hiddenPayload.scheduled?.length) scheduled.push(...e.hiddenPayload.scheduled);

    // Player-facing consequence snippets (sanitized; no hidden payload).
    if (e.type === "SANCTIONS_WARNING") publicConsequences.push("Sanctions risk is now being discussed in operational terms.");
    if (e.type === "BORDER_INCIDENT") publicConsequences.push("Border incident raises attention and narrows escalation room.");
    if (e.type === "PROTESTS") publicConsequences.push("Protest logistics are visible; handling choices will be judged.");
    if (e.type === "LEAKED_AUDIO") publicConsequences.push("Corruption narratives gain oxygen; elite discipline matters.");
    if (e.type === "ARMS_INTERDICTION") publicConsequences.push("Procurement disruption reduces readiness and increases scrutiny.");
    if (e.type === "IMF_CONTACT") publicConsequences.push("Financing channels may open—at political cost.");
    if (e.type === "CYBER_INTRUSION") publicConsequences.push("A cyber incident erodes confidence; attribution remains uncertain.");
    if (e.type === "ALLIANCE_SIGNAL") publicConsequences.push("Alliance signaling suggests credibility is being evaluated.");
  }

  return {
    publicTextBlocks: [],
    publicConsequences,
    hiddenOps,
    publicOps,
    scheduled,
    signalsUnknown: [
      "Attribution remains disputed on at least one incident this turn.",
      "Some economic effects will land with a 1–2 turn delay (prices, financing conditions).",
    ],
  };
}

export function resolvePlayerActions(world: WorldState, actions: PlayerAction[]): ResolutionBundle {
  const publicConsequences: string[] = [];
  const publicOps: EffectOp[] = [];
  const hiddenOps: EffectOp[] = [];
  const scheduled = [...world.scheduled];
  const signalsUnknown: string[] = [];

  for (const a of actions) {
    switch (a.kind) {
      case "DIPLOMACY": {
        const target = world.actors[a.targetActor];
        const cred = world.player.politics.credibilityByActor[a.targetActor];
        const toneFactor = a.tone === "conciliatory" ? +1 : a.tone === "firm" ? 0 : -1;
        const intensity = a.intensity;

        // Credibility is sticky; bluffing (hostile threats) with low capability punishes hard.
        if (a.subkind === "THREAT") {
          const capability = (world.player.military.readiness + world.player.military.logistics) / 2;
          const bluffRisk = clamp100(70 - cred + (55 - capability) * 0.9) / 100;
          if (rngChance(world.rng, bluffRisk)) {
            world.player.politics.credibilityByActor[a.targetActor] = clamp100(
              world.player.politics.credibilityByActor[a.targetActor] - (10 + 2 * intensity),
            );
            hiddenOps.push({
              kind: "DELTA",
              key: "player.politics.credibilityGlobal",
              amount: -8 - 3 * intensity,
              reason: "Threat perceived as bluff",
              visibility: "hidden",
            });
            publicConsequences.push("Your threat was met with controlled skepticism. Private pushback increased.");
          } else {
            world.player.politics.credibilityByActor[a.targetActor] = clamp100(
              world.player.politics.credibilityByActor[a.targetActor] + (2 + intensity),
            );
            hiddenOps.push({
              kind: "DELTA_ACTOR",
              actorId: a.targetActor,
              field: "willingnessToEscalate",
              amount: -2 * intensity,
              reason: "Deterrence effect from credible threat",
              visibility: "hidden",
            });
            publicConsequences.push("Your threat created short-term caution in the target’s messaging.");
          }
        }

        const trustDelta = (a.tone === "conciliatory" ? +4 : a.tone === "firm" ? +1 : -4) * intensity;
        hiddenOps.push({
          kind: "DELTA_ACTOR",
          actorId: a.targetActor,
          field: "trust",
          amount: trustDelta,
          reason: "Diplomatic engagement shifts trust",
          visibility: "hidden",
        });

        // Public vs private affects attention and domestic perceptions.
        if (a.isPublic) {
          publicOps.push({
            kind: "DELTA",
            key: "global.attentionLevel",
            amount: 3 + intensity,
            reason: "Public diplomacy draws attention",
            visibility: "public",
          });
          hiddenOps.push({
            kind: "DELTA",
            key: "player.politics.publicApproval",
            amount: toneFactor * (2 + intensity),
            reason: "Public posture affects approval",
            visibility: "hidden",
          });
        } else {
          hiddenOps.push({
            kind: "DELTA",
            key: "player.politics.credibilityGlobal",
            amount: a.tone === "conciliatory" ? +1 : 0,
            reason: "Quiet consistency marginally improves credibility",
            visibility: "hidden",
          });
          world.player.politics.credibilityByActor[a.targetActor] = clamp100(
            world.player.politics.credibilityByActor[a.targetActor] + (a.tone === "conciliatory" ? 2 : 1),
          );
        }

        publicConsequences.push(
          `Diplomacy: ${target.name} received a ${a.isPublic ? "public" : "private"} ${a.subkind.toLowerCase().replace("_", " ")} on ${a.topic}.`,
        );
        break;
      }
      case "ECONOMY": {
        const i = a.intensity;
        if (a.subkind === "SUBSIDIES") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.publicApproval", amount: +3 * i, reason: "Subsidies ease pain", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: +2 * i, reason: "Visible relief buys time", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.debtStress", amount: +3 * i, reason: "Subsidies widen deficit", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: -2 * i, reason: "Financing concerns rise", visibility: "hidden" });
          scheduled.push({ id: `T${world.turn}-SC-INFLATION_LAG`, dueTurn: world.turn + rngInt(world.rng, 1, 2), kind: "INFLATION_LAG", payload: {} });
          publicConsequences.push("Economy: targeted subsidies announced; markets are watching financing.");
          break;
        }
        if (a.subkind === "AUSTERITY") {
          hiddenOps.push({ kind: "DELTA", key: "player.economy.debtStress", amount: -4 * i, reason: "Austerity improves fiscal optics", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: +2 * i, reason: "Creditor confidence marginally improves", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.publicApproval", amount: -4 * i, reason: "Austerity hurts households", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.unrest", amount: +3 * i, reason: "Austerity triggers protest risk", visibility: "hidden" });
          publicConsequences.push("Economy: austerity package signaled; domestic blowback likely.");
          break;
        }
        if (a.subkind === "INDUSTRIAL_PUSH") {
          hiddenOps.push({ kind: "DELTA", key: "player.economy.unemployment", amount: -2 * i, reason: "Industrial push absorbs labor", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.debtStress", amount: +2 * i, reason: "Industrial policy spending", visibility: "hidden" });
          scheduled.push({ id: `T${world.turn}-SC-ELITE_SPLIT_RISK`, dueTurn: world.turn + 2, kind: "ELITE_SPLIT_RISK", payload: {} });
          publicConsequences.push("Economy: industrial push launched; benefits are delayed and uneven.");
          break;
        }
        // TRADE_DEAL_ATTEMPT
        const t = a.targetActor ?? rngPick(world.rng, ["EU", "CHINA", "US"]);
        const trust = world.actors[t].trust;
        if (trust >= 55 || rngChance(world.rng, 0.25 + trust / 200)) {
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: +3 * i, reason: "Trade deal improves outlook", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA_ACTOR", actorId: t, field: "trust", amount: +2 * i, reason: "Deal improves trust", visibility: "hidden" });
          publicConsequences.push(`Economy: trade talks with ${world.actors[t].name} show movement; terms are still unclear.`);
          signalsUnknown.push("Trade deal implementation risk remains; domestic winners/losers will emerge later.");
        } else {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.credibilityGlobal", amount: -2, reason: "Failed trade approach looks weak", visibility: "hidden" });
          publicConsequences.push(`Economy: outreach to ${world.actors[t].name} stalled; counterpart demanded preconditions.`);
        }
        break;
      }
      case "MILITARY": {
        const i = a.intensity;
        if (a.subkind === "MOBILIZE") {
          publicOps.push({ kind: "DELTA", key: "global.attentionLevel", amount: +4 * i, reason: "Mobilization raises attention", visibility: "public" });
          hiddenOps.push({ kind: "DELTA", key: "player.military.readiness", amount: +8 * i, reason: "Mobilization increases readiness", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: -3 * i, reason: "Mobilization costs and uncertainty", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.warSupport", amount: +2 * i, reason: "Rally effect", visibility: "hidden" });
          publicConsequences.push("Military: mobilization posture increased; economic costs will follow.");
          break;
        }
        if (a.subkind === "DEFENSIVE_POSTURE") {
          hiddenOps.push({ kind: "DELTA", key: "player.military.readiness", amount: +4 * i, reason: "Defensive readiness improvement", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "global.attentionLevel", amount: +2, reason: "Visible posture adjustment", visibility: "public" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.warSupport", amount: -1, reason: "Defensive posture seen as cautious", visibility: "hidden" });
          publicConsequences.push("Military: defensive posture tightened; deterrence improves modestly.");
          break;
        }

        const target = a.targetActor ?? "REGIONAL_1";
        const targetName = world.actors[target].name;

        if (a.subkind === "LIMITED_STRIKE") {
          publicOps.push({ kind: "DELTA", key: "global.attentionLevel", amount: +8 + 2 * i, reason: "Strike increases attention", visibility: "public" });
          hiddenOps.push({ kind: "DELTA_ACTOR", actorId: target, field: "trust", amount: -6 - 2 * i, reason: "Strike reduces trust", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA_ACTOR", actorId: target, field: "willingnessToEscalate", amount: +4 + 2 * i, reason: "Retaliation incentives rise", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.credibilityGlobal", amount: +2, reason: "Demonstrated willingness to act", visibility: "hidden" });

          // Risk of war initiation.
          if (world.conflicts.length === 0 && rngChance(world.rng, 0.4 + i * 0.15)) {
            world.conflicts.push({
              id: `C-${world.turn}-${target}`,
              name: `Limited war with ${targetName}`,
              belligerents: { attacker: "PLAYER", defender: target },
              escalationLevel: (i >= 3 ? 3 : 2) as 2 | 3,
              fronts: [
                { region: a.targetRegion ?? "Border sector", control: "contested", intensity: 55 + 10 * i },
              ],
              attrition: 25 + 8 * i,
              occupationBurden: 0,
              insurgencyRisk: 15,
              civilianHarm: 10 + 5 * i,
              cumulativeCasualties: 8 + 6 * i,
            });
            publicConsequences.push("A limited strike escalated into sustained exchanges. A war front has opened.");
          } else {
            publicConsequences.push(`Limited strike conducted; ${targetName} response posture hardened.`);
          }
          break;
        }

        if (a.subkind === "FULL_INVASION") {
          publicOps.push({ kind: "DELTA", key: "global.attentionLevel", amount: +18 + 3 * i, reason: "Invasion spikes attention", visibility: "public" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.credibilityGlobal", amount: -3, reason: "Invasion triggers credibility loss", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA_ACTOR", actorId: target, field: "willingnessToEscalate", amount: +10, reason: "War response escalates", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.military.readiness", amount: -6 * i, reason: "Operational strain", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: -6 * i, reason: "War shocks economy", visibility: "hidden" });

          // Start conflict (if not already).
          if (!world.conflicts.some((c) => c.belligerents.defender === target || c.belligerents.attacker === target)) {
            world.conflicts.push({
              id: `C-${world.turn}-INV-${target}`,
              name: `War with ${targetName}`,
              belligerents: { attacker: "PLAYER", defender: target },
              escalationLevel: (i >= 2 ? 4 : 3) as 3 | 4,
              fronts: [
                { region: a.targetRegion ?? "Northern approach", control: "contested", intensity: 70 + 10 * i },
                { region: "Air/Drone corridor", control: "contested", intensity: 55 + 8 * i },
              ],
              attrition: 40 + 12 * i,
              occupationBurden: 20 + 10 * i,
              insurgencyRisk: 25 + 8 * i,
              civilianHarm: 25 + 10 * i,
              cumulativeCasualties: 20 + 12 * i,
            });
          }

          // Sanctions become very likely.
          scheduled.push({
            id: `T${world.turn}-SC-SANCTIONS_BITE-INV`,
            dueTurn: world.turn + 1,
            kind: "SANCTIONS_BITE",
            payload: { severity: 80 },
          });
          publicConsequences.push(`Full invasion initiated against ${targetName}. International response is mobilizing.`);
          signalsUnknown.push("Alliance reactions may depend on private treaties and intelligence not yet visible to you.");
          break;
        }

        if (a.subkind === "PROXY_SUPPORT") {
          publicOps.push({ kind: "DELTA", key: "global.attentionLevel", amount: +5 * i, reason: "Proxy support raises attention", visibility: "public" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.credibilityGlobal", amount: -1 * i, reason: "Plausible deniability weakens over time", visibility: "hidden" });
          scheduled.push({
            id: `T${world.turn}-SC-INSURGENCY_SPIKE`,
            dueTurn: world.turn + rngInt(world.rng, 1, 3),
            kind: "INSURGENCY_SPIKE",
            payload: { linkedTo: target },
          });
          publicConsequences.push(`Security: proxy support expanded. Blowback risk increases over time.`);
          break;
        }

        // ARMS_PURCHASE
        hiddenOps.push({ kind: "DELTA", key: "player.military.readiness", amount: +3 * i, reason: "Arms purchases improve readiness", visibility: "hidden" });
        hiddenOps.push({ kind: "DELTA", key: "player.economy.debtStress", amount: +2 * i, reason: "Arms purchases strain budget", visibility: "hidden" });
        publicConsequences.push("Military: arms procurement accelerated; delivery timelines remain uncertain.");
        signalsUnknown.push("Procurement may trigger interdiction or sanction scrutiny in future turns.");
        break;
      }
      case "INTEL": {
        const i = a.intensity;
        if (a.subkind === "SURVEILLANCE") {
          hiddenOps.push({
            kind: "DELTA",
            key: "player.politics.credibilityGlobal",
            amount: +1,
            reason: "Better information reduces contradictions in messaging",
            visibility: "hidden",
          });
          scheduled.push({
            id: `T${world.turn}-SC-INTEL_REVELATION`,
            dueTurn: world.turn + 1,
            kind: "INTEL_REVELATION",
            payload: { intensity: i },
          });
          publicConsequences.push("Intel: surveillance increased; useful clarity may arrive next turn.");
          break;
        }
        if (a.subkind === "COUNTERINTEL") {
          hiddenOps.push({
            kind: "DELTA",
            key: "player.politics.eliteCohesion",
            amount: rngChance(world.rng, 0.35) ? -3 : 0,
            reason: "Counterintel sweep spooks factions",
            visibility: "hidden",
          });
          hiddenOps.push({
            kind: "DELTA",
            key: "player.politics.legitimacy",
            amount: +1 * i,
            reason: "Perceived competence against subversion",
            visibility: "hidden",
          });
          publicConsequences.push("Intel: counterintelligence sweep initiated; side effects on elites are possible.");
          break;
        }
        // COVERT_OP
        hiddenOps.push({
          kind: "DELTA",
          key: "player.politics.credibilityGlobal",
          amount: rngChance(world.rng, 0.4) ? -4 : 0,
          reason: "Covert operation exposure risk",
          visibility: "hidden",
        });
        hiddenOps.push({
          kind: "DELTA_ACTOR",
          actorId: a.targetActor ?? "REGIONAL_1",
          field: "trust",
          amount: -2 * i,
          reason: "Covert action harms trust if suspected",
          visibility: "hidden",
        });
        publicConsequences.push("Intel: covert operation authorized. Attribution remains uncertain.");
        signalsUnknown.push("If exposed, the operation will degrade credibility quickly.");
        break;
      }
      case "MEDIA": {
        const i = a.intensity;
        if (a.subkind === "PROPAGANDA_PUSH") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.mediaControl", amount: +3 * i, reason: "Propaganda consolidates narrative channels", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.publicApproval", amount: +1 * i, reason: "Short-term rally effect", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: -1 * i, reason: "Overreach harms legitimacy", visibility: "hidden" });
          publicConsequences.push("Media: state narrative push intensified. Credibility depends on outcomes matching rhetoric.");
          break;
        }
        if (a.subkind === "CENSORSHIP_CRACKDOWN") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.mediaControl", amount: +6 * i, reason: "Censorship increases control", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: -3 * i, reason: "Crackdown damages legitimacy", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.unrest", amount: +2 * i, reason: "Backlash increases unrest", visibility: "hidden" });
          publicConsequences.push("Media: censorship crackdown ordered. Long-term trust is likely to erode.");
          break;
        }
        // NARRATIVE_FRAMING
        hiddenOps.push({ kind: "DELTA", key: "player.politics.credibilityGlobal", amount: +1, reason: "Disciplined messaging reduces contradictions", visibility: "hidden" });
        hiddenOps.push({ kind: "DELTA", key: "player.politics.publicApproval", amount: +1, reason: "Clear messaging helps marginally", visibility: "hidden" });
        publicConsequences.push("Media: disciplined framing delivered; impact depends on follow-through.");
        break;
      }
      case "INSTITUTIONS": {
        const i = a.intensity;
        if (a.subkind === "PURGE_ELITES") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.eliteCohesion", amount: -2 * i, reason: "Purge creates fear and factionalism", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.militaryLoyalty", amount: -1 * i, reason: "Military resents politicization", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.mediaControl", amount: +2 * i, reason: "Purge consolidates control", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: -2 * i, reason: "Purges look unconstitutional", visibility: "hidden" });
          scheduled.push({ id: `T${world.turn}-SC-ELITE_SPLIT_RISK-PURGE`, dueTurn: world.turn + 1, kind: "ELITE_SPLIT_RISK", payload: {} });
          publicConsequences.push("Institutions: elite purge executed. Control improves, but backlash risk rises.");
          break;
        }
        if (a.subkind === "REFORM_PACKAGE") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: +3 * i, reason: "Reform improves legitimacy", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.eliteCohesion", amount: -2 * i, reason: "Reform threatens rents", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.economy.economicStability", amount: -1 * i, reason: "Transition costs", visibility: "hidden" });
          publicConsequences.push("Institutions: reform package announced. Implementation friction is expected.");
          signalsUnknown.push("Reforms will trigger quiet resistance from rent-holders.");
          break;
        }
        if (a.subkind === "ANTI_CORRUPTION_DRIVE") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.corruption", amount: -4 * i, reason: "Enforcement reduces corruption", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: +3 * i, reason: "Anti-corruption improves legitimacy", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.eliteCohesion", amount: -2 * i, reason: "Targets create elite fractures", visibility: "hidden" });
          scheduled.push({ id: `T${world.turn}-SC-ELITE_SPLIT_RISK-AC`, dueTurn: world.turn + 2, kind: "ELITE_SPLIT_RISK", payload: {} });
          publicConsequences.push("Institutions: anti-corruption drive launched. Elite retaliation risk increases.");
          break;
        }
        // ELECTION_TIMING
        if (world.player.regimeType === "authoritarian") {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: -2, reason: "Election timing move looks managed", visibility: "hidden" });
          publicConsequences.push("Institutions: election timing adjusted; public trust impact is uncertain.");
        } else {
          hiddenOps.push({ kind: "DELTA", key: "player.politics.legitimacy", amount: +2 * i, reason: "Electoral mandate play", visibility: "hidden" });
          hiddenOps.push({ kind: "DELTA", key: "player.politics.unrest", amount: +2, reason: "Campaign polarizes", visibility: "hidden" });
          publicConsequences.push("Institutions: election timing moved. Polarization risk rises.");
        }
        break;
      }
    }
  }

  // Credibility-by-actor tracks "stickiness" and punishes repeated bluffing faster than global credibility.
  const bluffCount = actions.filter((a) => a.kind === "DIPLOMACY" && a.subkind === "THREAT").length;
  if (bluffCount >= 1) {
    const penalty = 3 + 2 * (bluffCount - 1);
    hiddenOps.push({
      kind: "DELTA",
      key: "player.politics.credibilityGlobal",
      amount: -penalty,
      reason: "Threat overuse erodes credibility",
      visibility: "hidden",
    });
    publicConsequences.push("Credibility: repeated threats are being discounted in private channels.");
  }

  return {
    publicTextBlocks: [],
    publicConsequences,
    hiddenOps,
    publicOps,
    scheduled,
    signalsUnknown: signalsUnknown.length ? signalsUnknown : ["Some effects will only be visible after 1–3 turns."],
  };
}

