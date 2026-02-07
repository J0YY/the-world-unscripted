"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { GameSnapshot } from "@/engine";
import type { MapMode } from "./types";
import { deriveGpf } from "./adapters";
import WorldPressure from "./WorldPressure";
import { AnimatePresence, motion } from "framer-motion";
import HotspotList from "./HotspotList";
import TurnDeltasPanel from "./TurnDeltasPanel";
import LayerToggle from "./LayerToggle";
import SignalsStrip from "./SignalsStrip";
import BriefingFeed from "./BriefingFeed";
import TourButton from "./TourButton";
import IntelChatbot from "./IntelChatbot";
import InterrogationRoom from "./InterrogationRoom";
import DiplomacyPanel from "../DiplomacyPanel";
import { Info, ScanEye, TrendingUp } from "lucide-react";

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
  onModeChange,
}: {
  snapshot: GameSnapshot;
  rightSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode;
  onModeChange?: (mode: MapMode) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<MapMode>("location");
  const [intelFog, setIntelFog] = useState(true);
  const [showExposure, setShowExposure] = useState(true);
  const [leftTab, setLeftTab] = useState<"intel" | "diplomacy">("intel");
  const bootTurnRef = useRef<number>(snapshot.turn);
  const [bootKey, setBootKey] = useState(0);
  const [bootActive, setBootActive] = useState(false);

  useEffect(() => {
    if (bootTurnRef.current === snapshot.turn) return;
    bootTurnRef.current = snapshot.turn;
    setBootKey((k) => k + 1);
    setBootActive(true);
    const t = setTimeout(() => setBootActive(false), 560);
    return () => clearTimeout(t);
  }, [snapshot.turn]);
  const [isInterrogationOpen, setIsInterrogationOpen] = useState(false);
  const [interrogationStatus, setInterrogationStatus] = useState<"ready" | "completed" | "failed">("ready");
  const [showRewardToast, setShowRewardToast] = useState(false);
  
  // Reset interrogation status on new turn
  useEffect(() => {
     setInterrogationStatus("ready");
  }, [snapshot.turn]);

  // Determine if a spy is available (33% chance per turn -> ~once every 3 turns)
  const isSpyAvailable = useMemo(() => {
     // Deterministic random based on turn + gameId so it persists across re-renders/reloads for the same turn
     const seedStr = `${snapshot.gameId}-${snapshot.turn}`;
     let h = 0xdeadbeef;
     for(let i = 0; i < seedStr.length; i++)
        h = Math.imul(h ^ seedStr.charCodeAt(i), 2654435761);
     
     const val = ((h ^ h >>> 16) >>> 0) / 4294967296;
     
     return val < 0.33;
  }, [snapshot.turn, snapshot.gameId]);

  const targetCountry = useMemo(() => {
     // Pick a neighbor or a major power from diplomacy
     const neighbors = snapshot.countryProfile.neighbors;
     const powers = snapshot.diplomacy?.nations.map(n => n.name) || [];
     const candidates = [...neighbors, ...powers];
     const seed = snapshot.turn;
     if (candidates.length === 0) return "Unknown Power";
     return candidates[seed % candidates.length];
  }, [snapshot.countryProfile.neighbors, snapshot.diplomacy, snapshot.turn]);

  const missionObjective = useMemo(() => {
     const objectives = [
        "Extract details regarding the recent mobilization of armored divisions near the border.",
        "Verify rumors of a new biochemical weapon being developed in secret underground labs.",
        "Identify the network of political dissidents being funded to destabilize our regime.",
        "Locate the source of the recent cyber-attacks on our national power grid.",
        "Determine the true allegiance of the double agent 'Nightingale' operating in our capital.",
        "Obtain the launch codes or location of the rogue tactical missile shipment.",
        "Uncover the details of the secret trade agreement being negotiated with our rival.",
        "Find the location of the safehouse where the opposition leader is hiding."
     ];
     // Use a combination of turn and gameId for a stable but unique seed
     const seedStr = `${snapshot.gameId}-${snapshot.turn}-objective`;
     let h = 0x811c9dc5;
     for(let i = 0; i < seedStr.length; i++)
        h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
     
     const index = Math.abs(h) % objectives.length;
     return objectives[index];
  }, [snapshot.gameId, snapshot.turn]);

  const derivedMode = mode === "world-events" ? "world-events" : "relationship";
  const derived = useMemo(() => deriveGpf(snapshot, derivedMode), [snapshot, derivedMode]);

  function handleModeChange(nextMode: MapMode) {
    setMode(nextMode);
    onModeChange?.(nextMode);
  }

  const powerModel = useMemo(() => {
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const est = (m: { estimatedValue: number } | undefined) => clamp(Number.isFinite(m?.estimatedValue) ? m!.estimatedValue : 50);
    const inv = (x: number) => 100 - clamp(x);

    const ind = snapshot.playerView.indicators;
    const econ = est(ind.economicStability);
    const legitimacy = est(ind.legitimacy);
    const cred = est(ind.internationalCredibility);
    const domestic =
      0.18 * econ +
      0.14 * legitimacy +
      0.10 * est(ind.publicApproval) +
      0.10 * est(ind.eliteCohesion) +
      0.08 * est(ind.militaryLoyalty) +
      0.12 * cred +
      0.12 * est(ind.sovereigntyIntegrity) +
      0.06 * est(ind.intelligenceClarity) +
      0.05 * inv(est(ind.inflationPressure)) +
      0.03 * inv(est(ind.unrestLevel)) +
      0.02 * inv(est(ind.warStatus));

    const stances = Array.isArray(snapshot.diplomacy?.nations) ? snapshot.diplomacy!.nations.map((n) => clamp(n.stance)) : [];
    const influence = stances.length ? stances.reduce((a, b) => a + b, 0) / stances.length : 50;

    const powerIndex = clamp(Math.round(domestic * 0.8 + influence * 0.2));
    return {
      powerIndex,
      breakdown: {
        economicStability: econ,
        legitimacy,
        internationalCredibility: cred,
        influence: clamp(Math.round(influence)),
        mix: { domestic: 0.8, influence: 0.2 },
      },
    };
  }, [snapshot]);

  return (
    <main className="font-mono min-h-screen max-w-[1800px] mx-auto relative overflow-hidden px-4 md:px-6 pt-6 md:pt-8 pb-8">
      <AnimatePresence initial={false}>
        {bootActive ? (
          <motion.div
            key={bootKey}
            className="pointer-events-none absolute inset-0 z-[80] overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            aria-hidden="true"
          >
            <div
              className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(180deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 2px, transparent 5px)",
              }}
            />
            <motion.div
              className="absolute left-0 right-0 h-16 bg-gradient-to-b from-transparent via-white/15 to-transparent mix-blend-overlay"
              initial={{ y: -90 }}
              animate={{ y: "110%" }}
              transition={{ duration: 0.55, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute inset-0 bg-white/10"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.18, 0.05, 0] }}
              transition={{ duration: 0.55, times: [0, 0.14, 0.45, 1] }}
            />
            <motion.div
              className="absolute left-4 top-4 text-[10px] font-mono uppercase tracking-[0.3em] text-white/55"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: [0, 1, 0.6, 0], y: [-4, 0, 0, 2] }}
              transition={{ duration: 0.55, times: [0, 0.18, 0.6, 1] }}
            >
              SYSTEM HANDSHAKE
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={
          bootActive
            ? {
                opacity: [0.75, 1, 0.86, 1],
                filter: [
                  "brightness(1.25) contrast(1.15)",
                  "brightness(1) contrast(1)",
                  "brightness(1.12) contrast(1.05)",
                  "brightness(1) contrast(1)",
                ],
              }
            : { opacity: 1, filter: "brightness(1) contrast(1)" }
        }
        transition={{ duration: 0.55, times: [0, 0.22, 0.55, 1], ease: "easeOut" }}
      >
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
              powerIndex={powerModel.powerIndex}
              powerBreakdown={powerModel.breakdown}
              narrativeGravity={derived.narrativeGravity}
              systemStrain={derived.systemStrain}
            />
          </div>
          <div id="gpf-turn-deltas">
            <TurnDeltasPanel snapshot={snapshot} />
          </div>
          <div id="gpf-hotspots">
            {mode === "world-events" || mode === "location" ? null : (
              <HotspotList mode={mode} hotspots={derived.hotspots} />
            )}
          </div>
          <div id="gpf-intel" className="flex flex-col gap-2">
            <div className="flex items-center gap-3 border-b border-[var(--ds-gray-alpha-200)] pb-1 mb-1 justify-between">
               <div className="flex items-center gap-3">
                  <button 
                     onClick={() => setLeftTab("intel")}
                     className={`px-1 text-xs font-mono uppercase tracking-tight transition-colors ${leftTab === "intel" ? "text-[var(--ds-gray-1000)] font-bold" : "text-[var(--ds-gray-500)] hover:text-[var(--ds-gray-900)]"}`}
                  >
                     Intel
                  </button>
                  <div className="h-3 w-px bg-[var(--ds-gray-alpha-200)]" />
                  <button 
                     onClick={() => setLeftTab("diplomacy")}
                     className={`px-1 text-xs font-mono uppercase tracking-tight transition-colors ${leftTab === "diplomacy" ? "text-[var(--ds-gray-1000)] font-bold" : "text-[var(--ds-gray-500)] hover:text-[var(--ds-gray-900)]"}`}
                  >
                     Diplomacy
                  </button>
               </div>
               {leftTab === "intel" && isSpyAvailable && interrogationStatus === "ready" && (
                  <button 
                    onClick={() => setIsInterrogationOpen(true)}
                    className="text-[10px] bg-red-900/20 hover:bg-red-900/40 text-red-400 px-2 py-0.5 rounded border border-red-900/30 animate-pulse flex items-center gap-1"
                  >
                    <span className="relative flex h-2 w-2">
                       <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                       <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    INTERROGATE
                  </button>
               )}
               {leftTab === "intel" && (!isSpyAvailable || interrogationStatus !== "ready") && (
                   <span className="text-[10px] text-[var(--ds-gray-500)] uppercase tracking-wider px-2 py-0.5 opacity-50 cursor-not-allowed">
                       {interrogationStatus === "completed" ? "Intel Extracted" : interrogationStatus === "failed" ? "Subject Unresponsive" : "No Captives"}
                   </span>
               )}
            </div>
            {leftTab === "intel" ? (
               <IntelChatbot llmMode={snapshot.llmMode} />
            ) : (
               <DiplomacyPanel snapshot={snapshot} gameId={snapshot.gameId} />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0" id="gpf-map">
          <LayerToggle
            mode={mode}
            onModeChange={handleModeChange}
            intelFog={intelFog}
            onIntelFogChange={setIntelFog}
            showExposure={showExposure}
            onShowExposureChange={setShowExposure}
            locationLabel={snapshot.countryProfile.name}
          />
          <div className="border border-[var(--ds-gray-alpha-200)] rounded overflow-hidden">
            <PixelWorldMap
              mode={mode}
              countryColors={derived.countryColors}
              briefings={derived.briefings}
              countryCodeToNames={derived.countryCodeToNames}
              neighborNames={snapshot.countryProfile.neighbors}
            />
          </div>
          <SignalsStrip signals={derived.signals} turn={derived.turn} />
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
      </motion.div>
      
      {showRewardToast && (
        <div className="fixed bottom-8 right-8 z-[100] bg-neutral-900/95 border border-green-500/50 text-green-100 px-6 py-4 rounded-lg shadow-2xl animate-in slide-in-from-bottom duration-500 fade-in flex items-center gap-4 backdrop-blur-xl">
            <div className="p-3 bg-green-500/20 rounded-full border border-green-500/30 animate-pulse">
                <ScanEye className="w-6 h-6 text-green-400" />
            </div>
            <div>
                <h4 className="font-mono font-bold text-sm uppercase tracking-widest text-green-300">New Intelligence Integrated</h4>
                <div className="flex items-center gap-2 mt-1">
                   <TrendingUp className="w-3 h-3 text-green-400" />
                   <p className="text-xs text-neutral-300 font-mono">Clarity increased (+15). Map data updated.</p>
                </div>
            </div>
        </div>
      )}

      <InterrogationRoom 
        isOpen={isInterrogationOpen}
        onClose={() => setIsInterrogationOpen(false)}
        onSuccess={async () => {
           setInterrogationStatus("completed");
           try {
              // Claim reward
              const res = await fetch("/api/game/interrogation/reward", {
                 method: "POST",
                 headers: { "Content-Type": "application/json" },
                 body: JSON.stringify({ gameId: snapshot.gameId, amount: 15 })
              });
              if(res.ok) {
                  router.refresh();
                  setShowRewardToast(true);
                  setTimeout(() => setShowRewardToast(false), 5000);
              }
           } catch(e) {
              console.error("Failed to claim reward", e);
           }
           setIsInterrogationOpen(false);
        }}
        onFailure={() => {
           setInterrogationStatus("failed");
           // Keep open briefly or close? Let's close for now to enforce the "lost chance" feeling
           setIsInterrogationOpen(false);
        }}
        targetCountry={targetCountry}
        objective={missionObjective}
      />
    </main>
  );
}

