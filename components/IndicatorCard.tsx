import type { ObservedMetric } from "@/engine";
import { Badge, Card } from "./ui";

function confColor(conf: ObservedMetric["confidence"]): string {
  switch (conf) {
    case "high":
      return "bg-emerald-500/20 text-emerald-200";
    case "med":
      return "bg-amber-500/20 text-amber-200";
    case "low":
      return "bg-red-500/20 text-red-200";
  }
}

export function IndicatorCard({ label, metric }: { label: string; metric: ObservedMetric }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-white/80">{label}</div>
        <span className={`rounded-md px-2 py-0.5 text-xs ${confColor(metric.confidence)}`}>{metric.confidence}</span>
      </div>
      <div className="text-2xl font-semibold text-white">{metric.estimatedValue}</div>
      <div className="flex flex-wrap gap-1">
        {metric.knownDrivers.slice(0, 3).map((d) => (
          <Badge key={d}>{d}</Badge>
        ))}
      </div>
    </Card>
  );
}

