import type { Briefing } from "@/engine";
import { Card } from "./ui";

export function WorldPulse({ briefing }: { briefing: Briefing }) {
  return (
    <Card className="h-full">
      <div className="text-sm font-semibold text-white">World pulse</div>
      <div className="mt-3">
        <div className="text-xs font-semibold text-white/75">Headlines</div>
        <ul className="mt-2 space-y-2 text-sm text-white/90">
          {briefing.headlines.map((h) => (
            <li key={h} className="border-l border-white/10 pl-3">
              {h}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-white/75">Domestic rumor mill</div>
        <ul className="mt-2 space-y-2 text-sm text-white/85">
          {briefing.domesticRumors.map((r) => (
            <li key={r} className="border-l border-white/10 pl-3">
              {r}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-white/75">Diplomatic messages</div>
        <ul className="mt-2 space-y-2 text-sm text-white/85">
          {briefing.diplomaticMessages.map((m) => (
            <li key={m} className="border-l border-white/10 pl-3">
              {m}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-white/75">Intelligence notes</div>
        <ul className="mt-2 space-y-2 text-sm text-white/85">
          {briefing.intelBriefs.map((b, i) => (
            <li key={i} className="border-l border-white/10 pl-3">
              <div className="text-xs text-white/60">{b.confidence} confidence</div>
              <div>{b.text}</div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

