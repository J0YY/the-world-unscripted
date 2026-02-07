"use client";

export default function WorldPressure({
  pressureIndex,
  powerIndex,
  narrativeGravity,
  systemStrain,
}: {
  pressureIndex: number;
  powerIndex: number;
  narrativeGravity: number;
  systemStrain: number;
}) {
  const pressureColor =
    pressureIndex >= 75 ? "text-red-500" : pressureIndex >= 50 ? "text-amber-500" : "text-green-500";
  const powerColor = powerIndex >= 70 ? "text-emerald-500" : powerIndex >= 45 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="my-0 font-mono font-medium text-xs tracking-tight uppercase text-[var(--ds-gray-900)]">
          WORLD PRESSURE
        </h2>
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl md:text-5xl tracking-normal font-mono tabular-nums ${pressureColor}`}>
            {pressureIndex}
          </span>
          <span className="text-xl font-mono text-[var(--ds-gray-700)]">%</span>
        </div>
        <div className="w-full h-2 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
          <div
            className={`h-full rounded-sm transition-all ${
              pressureIndex >= 75 ? "bg-red-500" : pressureIndex >= 50 ? "bg-amber-500" : "bg-green-500"
            }`}
            style={{ width: `${pressureIndex}%` }}
          />
        </div>
        <div className="text-sm text-[var(--ds-gray-900)] font-mono tabular-nums">
          <span className="text-[var(--ds-gray-700)]">POWER</span>{" "}
          <span className={powerColor}>{powerIndex}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2 border-t border-[var(--ds-gray-alpha-200)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-[var(--ds-gray-900)]">Narrative Gravity</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
              <div className="h-full bg-blue-500 rounded-sm" style={{ width: `${narrativeGravity}%` }} />
            </div>
            <span className="text-xs font-mono tabular-nums text-[var(--ds-gray-1000)] w-8 text-right">
              {narrativeGravity}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-[var(--ds-gray-900)]">System Strain</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[var(--ds-gray-alpha-200)] rounded-sm overflow-hidden">
              <div className="h-full bg-amber-500 rounded-sm" style={{ width: `${systemStrain}%` }} />
            </div>
            <span className="text-xs font-mono tabular-nums text-[var(--ds-gray-1000)] w-8 text-right">
              {systemStrain}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

