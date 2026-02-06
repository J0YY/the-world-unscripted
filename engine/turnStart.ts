import { generateWorldBriefing } from "./briefing";
import { generateIncomingEvents } from "./events";
import type { Briefing, IncomingEvent, WorldState } from "./types";

export function generateBriefingAndEvents(
  world: WorldState,
  opts: { forcePressureEvent: boolean },
): { briefing: Briefing; events: IncomingEvent[] } {
  const briefing = generateWorldBriefing(world);
  const events = generateIncomingEvents(world, opts);
  return { briefing, events };
}

