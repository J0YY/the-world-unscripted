"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { GameSnapshot } from "@/engine";
import type { MapMode } from "./types";
import { deriveGpf } from "./adapters";
import WorldPressure from "./WorldPressure";
import HotspotList from "./HotspotList";
import LayerToggle from "./LayerToggle";
import SignalsStrip from "./SignalsStrip";
import BriefingFeed from "./BriefingFeed";
import TourButton from "./TourButton";
import IntelChatbot from "./IntelChatbot";
import { Info } from "lucide-react";

const PixelWorldMap = dynamic(() => import("./PixelWorldMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] md:h-[560px] bg-[var(--ds-background-100)] animate-pulse rounded-md" />
  ),
});

export default function GlobalPressureFieldPage({
  snapshot,
  rightSlot,
  bottomSlot,
}: {
  snapshot: GameSnapshot;
  rightSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode;
}) {
  const [mode, setMode] = useState<MapMode>("world-events");
  const [intelFog, setIntelFog] = useState(true);
  const [showExposure, setShowExposure] = useState(true);

  const derived = useMemo(() => deriveGpf(snapshot, mode), [snapshot, mode]);

  return (
    <main className="font-mono min-h-screen max-w-[1800px] mx-auto relative overflow-hidden px-4 md:px-6 pt-6 md:pt-8 pb-8">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-mono font-medium text-[var(--ds-gray-1000)] m-0">
              THE CONTROL ROOM
            </h1>
            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] p-1.5 text-[var(--ds-gray-900)] hover:bg-[var(--ds-gray-alpha-200)] transition"
                aria-label="Country dossier info"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-[360px] max-w-[85vw] rounded-lg border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] p-3 text-xs text-[var(--ds-gray-900)] shadow-xl group-hover:block">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">
                  Country dossier
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--ds-gray-1000)]">
                  {snapshot.countryProfile.name}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ds-gray-800)]">
                  {snapshot.countryProfile.regimeType.toUpperCase()} · Neighbors:{" "}
                  {snapshot.countryProfile.neighbors.slice(0, 4).join(", ")}
                  {snapshot.countryProfile.neighbors.length > 4 ? "…" : ""}
                </div>
                <div className="mt-2 text-[11px] text-[var(--ds-gray-800)] line-clamp-4">
                  {snapshot.countryProfile.geographySummary}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded bg-[var(--ds-gray-alpha-100)] p-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">
                      Resources
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--ds-gray-900)]">
                      Oil/Gas: {snapshot.countryProfile.resources.oilGas}
                      <br />
                      Food: {snapshot.countryProfile.resources.food}
                      <br />
                      Rare earths: {snapshot.countryProfile.resources.rareEarths}
                      <br />
                      Industry: {snapshot.countryProfile.resources.industrialBase}
                    </div>
                  </div>
                  <div className="rounded bg-[var(--ds-gray-alpha-100)] p-2">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">
                      Starting assessment
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--ds-gray-900)]">
                      Econ: {snapshot.countryProfile.startingAssessment?.economicStability.level ?? "unknown"}
                      <br />
                      Legitimacy: {snapshot.countryProfile.startingAssessment?.legitimacy.level ?? "unknown"}
                      <br />
                      Unrest: {snapshot.countryProfile.startingAssessment?.unrest.level ?? "unknown"}
                      <br />
                      Intel: {snapshot.countryProfile.startingAssessment?.intelClarity.level ?? "unknown"}
                    </div>
                  </div>
                </div>
                
              </div>
            </div>
          </div>
          <p className="text-xs md:text-sm text-[var(--ds-gray-900)] m-0 mt-1">
            Perception-layer map (signals are incomplete and delayed)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TourButton />
          <div className="px-2.5 py-1 bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono">
            <span className="text-[var(--ds-gray-900)]">Turn</span>{" "}
            <span className="text-[var(--ds-gray-1000)] font-medium">{derived.turn}</span>
          </div>
          <div className="px-2.5 py-1 bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono text-[var(--ds-gray-900)]">
            {derived.periodLabel}
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="w-full lg:w-64 xl:w-72 flex-shrink-0 space-y-6">
          <div id="gpf-pressure">
            <WorldPressure
              pressureIndex={derived.pressureIndex}
              deltaPerTurn={derived.deltaPerTurn}
              narrativeGravity={derived.narrativeGravity}
              systemStrain={derived.systemStrain}
            />
          </div>
          <div id="gpf-hotspots">
            <HotspotList mode={mode} hotspots={derived.hotspots} />
          </div>
          <div id="gpf-intel">
            <IntelChatbot llmMode={snapshot.llmMode} />
          </div>
        </div>

        <div className="flex-1 min-w-0" id="gpf-map">
          <LayerToggle
            mode={mode}
            onModeChange={setMode}
            intelFog={intelFog}
            onIntelFogChange={setIntelFog}
            showExposure={showExposure}
            onShowExposureChange={setShowExposure}
          />
          <div className="border border-[var(--ds-gray-alpha-200)] rounded overflow-hidden">
            <PixelWorldMap
              mode={mode}
              countryColors={derived.countryColors}
            />
          </div>
          <SignalsStrip signals={derived.signals} />
        </div>

        <div className="w-full lg:w-72 xl:w-96 flex-shrink-0 space-y-3">
          <div id="gpf-feed">
            <BriefingFeed briefings={derived.briefings} />
          </div>
          {rightSlot}
        </div>
      </div>

      {bottomSlot ? <div className="mt-6">{bottomSlot}</div> : null}

      <footer className="mt-6 pt-4 border-t border-[var(--ds-gray-alpha-200)]">
        <p className="text-[10px] md:text-xs text-[var(--ds-gray-500)] font-mono m-0 text-center">
          This view reflects perceived pressure. Ground truth is not shown.
        </p>
      </footer>
    </main>
  );
}

