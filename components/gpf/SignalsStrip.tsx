"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { UiSignal } from "./types";
import { cn } from "@/lib/utils";

import { Share2, Radio, Lock, Activity, Zap, Banknote, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ShieldAlert, Crosshair } from "lucide-react";

// --- Configuration ---
// Removed emojis, replaced with Lucide components
const SIGNAL_CONFIG: Record<string, { desc: string; color: string; Icon: React.ElementType }> = {
  coup: { desc: "Military chatter intercept", color: "#ef4444", Icon: Crosshair }, // Red
  border: { desc: "Satellite movement detection", color: "#f97316", Icon: Radio }, // Orange
  sanctions: { desc: "SWIFT transaction monitoring", color: "#eab308", Icon: Lock }, // Yellow
  alliance: { desc: "Diplomatic cable decryption", color: "#3b82f6", Icon: Share2 }, // Blue
  energy: { desc: "Grid load analysis", color: "#8b5cf6", Icon: Zap }, // Purple
  capital: { desc: "Offshore account triangulation", color: "#10b981", Icon: Banknote }, // Emerald
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function DecryptionMinigame({ 
  signal, 
  onComplete, 
  onClose 
}: { 
  signal: UiSignal; 
  onComplete: (tier: number) => void; 
  onClose: () => void 
}) {
  const [stage, setStage] = useState(0); // 0, 1, 2
  
  // Assign game types based on signal ID
  const [gameMode] = useState<"oscillator" | "grid" | "sequence">(() => {
     if (["coup", "border"].includes(signal.id)) return "grid";
     if (["alliance", "capital"].includes(signal.id)) return "sequence";
     return "oscillator"; // energy, sanctions
  });

  // --- Oscillator State ---
  const [targetPos, setTargetPos] = useState(50);
  const [cursorPos, setCursorPos] = useState(0);
  const [direction, setDirection] = useState(1);
  const speedRef = useRef(1.5 + (signal.intensity * 1.5));
  const requestRef = useRef<number | null>(null);

  // --- Grid State ---
  const [activeCell, setActiveCell] = useState<number | null>(null);
  const gridTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Sequence State ---
  const [sequence, setSequence] = useState<string[]>([]);
  const [seqIndex, setSeqIndex] = useState(0);
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<"playing" | "fail" | "success">("playing");

  // --- Oscillator Logic ---
  const animateOscillator = useCallback(() => {
    setCursorPos((prev) => {
      let next = prev + direction * speedRef.current;
      if (next > 100) { next = 100; setDirection(-1); }
      else if (next < 0) { next = 0; setDirection(1); }
      return next;
    });
    requestRef.current = requestAnimationFrame(animateOscillator);
  }, [direction]);

  // --- Grid Logic ---
  const nextGridTarget = useCallback((isInitial = false) => {
    // Ensure new cell is different
    setActiveCell(prev => {
        let next = Math.floor(Math.random() * 9);
        while (next === prev) next = Math.floor(Math.random() * 9);
        return next;
    });
    
    if (!isInitial) {
      // Made faster: Base reduced from 1000 to 750
      const timeout = Math.max(350, 750 - (stage * 150) - (signal.intensity * 250));
      gridTimerRef.current = setTimeout(() => {
        handleFail(); 
      }, timeout);
    }
  }, [stage, signal.intensity]);

  // --- Sequence Logic ---
  const generateSequence = useCallback(() => {
      const length = 3 + stage;
      const dirs = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      const newSeq = Array.from({ length }, () => dirs[Math.floor(Math.random() * dirs.length)]);
      setSequence(newSeq);
      setSeqIndex(0);
      
      // Ensure no timer is running initially - it starts on first input
      if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
      seqTimerRef.current = null;
  }, [stage, signal.intensity]);

  // --- Lifecycle & Handlers ---
  useEffect(() => {
    if (status !== "playing") return;

    if (gameMode === "oscillator") {
      requestRef.current = requestAnimationFrame(animateOscillator);
      return () => {
        if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      };
    } else if (gameMode === "grid") {
      if (stage === 0) nextGridTarget(true);
      return () => {
        if (gridTimerRef.current) clearTimeout(gridTimerRef.current);
      };
    }
  }, [animateOscillator, status, gameMode]);

  // Sequence Generation Lifecycle (Separate to track stage changes via generateSequence dependency)
  useEffect(() => {
    if (status === "playing" && gameMode === "sequence") {
        generateSequence();
        return () => {
          if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
        };
    }
  }, [status, gameMode, generateSequence]);

  // Sequence Key Listener
  useEffect(() => {
      if (status !== "playing" || gameMode !== "sequence" || sequence.length === 0) return;

      const handleKey = (e: KeyboardEvent) => {
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
          e.preventDefault();

          // Start timer on first valid key press if not already running
          if (seqIndex === 0 && !seqTimerRef.current) {
               const timePerKey = 350 - (signal.intensity * 150); 
               const totalTime = sequence.length * timePerKey;
               seqTimerRef.current = setTimeout(() => {
                   handleFail();
               }, totalTime);
          }

          if (e.key === sequence[seqIndex]) {
              // Correct Key
              const nextIdx = seqIndex + 1;
              setSeqIndex(nextIdx);
              if (nextIdx >= sequence.length) {
                  if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
                  seqTimerRef.current = null;
                  handleSuccess();
              }
          } else {
              // Wrong Key
              if (seqTimerRef.current) clearTimeout(seqTimerRef.current);
              seqTimerRef.current = null;
              handleFail();
          }
      };

      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
  }, [status, gameMode, sequence, seqIndex, signal.intensity]);


  const handleFail = () => {
    setStatus("fail");
    setTimeout(() => onComplete(stage), 1000); 
  };

  const handleSuccess = () => {
    if (stage >= 2) {
      setStatus("success");
      setTimeout(() => onComplete(3), 1000);
    } else {
      setStage(s => s + 1);
      // Mode specific transitions
      if (gameMode === "oscillator") {
        setTargetPos(Math.random() * 80 + 10);
        speedRef.current += 1.2; // Faster increase
      } else if (gameMode === "grid") {
        if (gridTimerRef.current) clearTimeout(gridTimerRef.current);
        gridTimerRef.current = null;
        nextGridTarget(false);
      } else if (gameMode === "sequence") {
          // Sequence re-generates in effect when stage changes
      }
    }
  };

  const handleOscillatorLock = () => {
    if (status !== "playing") return;
    const tolerance = 12 - (stage * 2);
    if (Math.abs(cursorPos - targetPos) < tolerance) {
      handleSuccess();
    } else {
      handleFail();
    }
  };

  const handleGridClick = (index: number) => {
    if (status !== "playing") return;
    if (index === activeCell) {
       if (gridTimerRef.current) clearTimeout(gridTimerRef.current);
       gridTimerRef.current = null;
       handleSuccess();
    } else {
      if (gridTimerRef.current) clearTimeout(gridTimerRef.current);
      gridTimerRef.current = null;
      handleFail();
    }
  };

  const config = SIGNAL_CONFIG[signal.id] || { color: "#fff", Icon: ShieldAlert };
  const Icon = config.Icon;

  // Helper for arrow rotation
  const getRotation = (key: string) => {
      switch(key) {
          case "ArrowUp": return "rotate-0";
          case "ArrowRight": return "rotate-90";
          case "ArrowDown": return "rotate-180";
          case "ArrowLeft": return "-rotate-90";
          default: return "";
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="w-[400px] bg-black border border-gray-700 rounded-xl p-6 shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Icon className="w-6 h-6 text-[var(--ds-gray-200)]" />
            <div>
              <h3 className="text-sm font-mono text-gray-400 uppercase">
                 {gameMode === "oscillator" ? "Frequency Lock" : gameMode === "grid" ? "Grid Triangulation" : "Key Sequencer"}
              </h3>
              <div className="text-lg font-bold text-white uppercase tracking-widest">{signal.label}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        {/* Game Area */}
        <div className="mb-4 bg-gray-900 rounded border border-gray-800 relative h-48 flex items-center justify-center overflow-hidden">
          
          {/* Game: Oscillator */}
          {gameMode === "oscillator" && (
             <div 
               className="relative w-full h-16 cursor-crosshair select-none mx-4" 
               onMouseDown={handleOscillatorLock}
             >
                <div 
                  className="absolute top-0 bottom-0 w-[24%] -translate-x-1/2 bg-white/10 border-x border-white/30 transition-all duration-300"
                  style={{ left: `${targetPos}%`, borderColor: config.color }} 
                />
                <div 
                  className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_15px_white] z-10"
                  style={{ left: `${cursorPos}%` }}
                />
                <div className="absolute -bottom-6 w-full text-center text-[10px] text-gray-500 font-mono">
                    CLICK TO LOCK
                </div>
             </div>
          )}
          
          {/* Game: Grid */}
          {gameMode === "grid" && (
             <div className="grid grid-cols-3 gap-3 p-4 w-full h-full max-w-[200px] max-h-[200px]">
                {Array.from({ length: 9 }).map((_, i) => (
                   <button
                     key={i}
                     onMouseDown={() => handleGridClick(i)}
                     className={cn(
                       "rounded-md transition-all duration-75 border border-gray-800/50",
                       activeCell === i ? "bg-emerald-500/80 shadow-[0_0_15px_#10b981] scale-95 border-emerald-400" : "bg-gray-800/40 hover:bg-gray-800/60",
                       status === "fail" && activeCell === i && "bg-red-500"
                     )}
                   />
                ))}
             </div>
          )}

          {/* Game: Sequence */}
          {gameMode === "sequence" && (
              <div className="flex gap-4 items-center justify-center p-2">
                  {sequence.map((key, i) => (
                      <div 
                        key={i}
                        className={cn(
                            "w-10 h-10 rounded border-2 flex items-center justify-center transition-all duration-200",
                            // Completed
                            i < seqIndex ? "border-emerald-500 bg-emerald-500/20 text-emerald-500 scale-90 opacity-50" :
                            // Current
                            i === seqIndex ? "border-white bg-white/10 text-white scale-110 shadow-[0_0_15px_rgba(255,255,255,0.3)]" :
                            // Future
                            "border-gray-700 text-gray-700 bg-gray-900"
                        )}
                      >
                          <ArrowUp className={cn("w-6 h-6", getRotation(key))} />
                      </div>
                  ))}
              </div>
          )}
          
          {/* Overlay Status */}
          {status === "fail" && (
             <div className="absolute inset-0 bg-red-500/20 backdrop-blur-[2px] z-50 flex items-center justify-center pointer-events-none">
                <span className="bg-black text-red-500 px-6 py-3 font-mono font-bold text-xl border border-red-500 rounded tracking-widest shadow-xl">
                   SIGNAL LOST
                </span>
             </div>
          )}
          {status === "success" && (
             <div className="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-50 flex items-center justify-center pointer-events-none">
                <span className="bg-black text-emerald-500 px-6 py-3 font-mono font-bold text-xl border border-emerald-500 rounded tracking-widest shadow-xl">
                   DECRYPTED
                </span>
             </div>
          )}
        </div>

        {/* Stage Progress */}
        <div className="flex gap-2 justify-center mb-6">
          {[0, 1, 2].map((i) => (
            <div 
              key={i} 
              className={cn(
                "w-full h-1.5 rounded-full transition-colors",
                i < stage ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : 
                i === stage ? "bg-gray-600 animate-pulse" : "bg-gray-800"
              )} 
            />
          ))}
        </div>

        <button 
          onClick={() => gameMode === "oscillator" ? handleOscillatorLock() : null}
          className="w-full py-4 bg-gray-100 hover:bg-white text-black font-mono font-bold uppercase tracking-widest rounded transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={status !== "playing"}
        >
          {status === "playing" 
             ? (gameMode === "oscillator" ? "LOCK SIGNAL [CLICK]" : gameMode === "sequence" ? "ENTER SEQUENCE [KEYS]" : stage === 0 ? "INITIATE LINK [CLICK]" : "TAP HIGHLIGHTED") 
             : status === "success" ? "ACCESS GRANTED" : "TERMINATED"}
        </button>
      </div>
    </div>
  );
}


// --- Main Strip Component ---
export default function SignalsStrip({ signals, turn = 1 }: { signals: UiSignal[]; turn?: number }) {
  // Store results: key = "signalId-turn", value = tier achieved (0-3)
  const [results, setResults] = useState<Record<string, number>>({});
  const [activeGame, setActiveGame] = useState<UiSignal | null>(null);

  const keyFor = (id: string) => `${id}-${turn}`;
  const getTier = (id: string) => results[keyFor(id)] ?? -1; // -1 means not attempted yet

  const handleComplete = (tier: number) => {
    if (activeGame) {
      setResults(prev => ({ ...prev, [keyFor(activeGame.id)]: tier }));
    }
    setActiveGame(null);
  };

  // Helper to render value based on tier
  const renderValue = (tier: number, value: number) => {
     if (tier === 3) return `${value}%`;
     if (tier === 2) return `~${Math.max(0, value - 5)}-${Math.min(100, value + 5)}%`;
     if (tier === 1) return `~${Math.max(0, value - 20)}-${Math.min(100, value + 20)}%`;
     return "??%";
  };

  const getStatusText = (tier: number, value: number) => {
     if (tier === 0) return "SIGNAL ENCRYPTED";
     if (tier < 3) return "LOW FIDELITY";
     return value > 60 ? "CRITICAL" : value > 30 ? "ELEVATED" : "STABLE";
  };

  return (
    <>
      <div className="w-full mt-4">
        {/* Large Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {signals.map((signal) => {
             const tier = getTier(signal.id);
             const unlocked = tier > 0;
             const config = SIGNAL_CONFIG[signal.id] || { desc: "Unknown Signal", color: "#fff", Icon: ShieldAlert };
             const Icon = config.Icon;
             const percentage = Math.round(signal.intensity * 100);

             return (
              <div
                key={signal.id}
                className={cn(
                  "relative group flex flex-col p-4 border rounded-xl transition-all duration-300 min-h-[100px]",
                  unlocked 
                    ? "bg-[var(--ds-gray-alpha-100)] border-[var(--ds-gray-alpha-200)]" 
                    : "bg-[var(--ds-background-200)] border-[var(--ds-gray-alpha-200)] border-dashed border-2"
                )}
              >
                {/* Header Row */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex flex-col">
                    <span className="text-[11px] uppercase tracking-widest font-mono text-[var(--ds-gray-900)] mb-1">
                      {signal.label}
                    </span>
                    <span className="text-[10px] text-[var(--ds-gray-600)]">
                      {unlocked ? config.desc : "Encryption active // Source obscured"}
                    </span>
                  </div>
                  <div className={`text-2xl transition-all ${unlocked ? "" : "opacity-30 grayscale blur-[1px]"}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                </div>

                {/* Data Row */}
                {unlocked ? (
                  // UNLOCKED STATE
                  <div className="animate-in fade-in zoom-in duration-300">
                    <div className="flex items-end gap-2 mb-2">
                      <span className="text-3xl font-mono font-bold text-[var(--ds-gray-1000)] tabular-nums">
                        {renderValue(tier, percentage)}
                      </span>
                      <span className={cn(
                        "text-xs font-mono mb-1.5 uppercase font-bold",
                        tier === 3 ? (percentage > 60 ? "text-red-500" : percentage > 30 ? "text-amber-500" : "text-emerald-500") : "text-gray-500"
                      )}>
                        {getStatusText(tier, percentage)}
                      </span>
                    </div>
                    {/* Progress Bar / Range Bar */}
                    <div className="w-full h-2 bg-[var(--ds-gray-alpha-200)] rounded overflow-hidden relative">
                      {tier === 3 ? (
                         <div 
                           className="h-full transition-all duration-1000 ease-out" 
                           style={{ width: `${percentage}%`, backgroundColor: config.color }} 
                         />
                      ) : (
                         // Range visualization for partial unlock
                         <div 
                           className="absolute h-full opacity-50"
                           style={{ 
                              left: `${Math.max(0, percentage - (tier === 1 ? 20 : 5))}%`,
                              width: `${tier === 1 ? 40 : 10}%`,
                              backgroundColor: config.color 
                           }}
                         />
                      )}
                    </div>
                  </div>
                ) : (
                  // LOCKED STATE
                  <div className="flex flex-col items-center justify-center gap-2 mt-1">
                    <div className="w-full flex justify-between items-center opacity-40">
                       <span className="font-mono text-xl tracking-tighter animate-pulse blur-sm select-none">??%</span>
                       <div className="h-2 w-1/2 bg-gray-500/20 rounded animate-pulse" />
                    </div>
                    {tier === 0 ? (
                        <div className="w-full py-2 mt-1 text-center text-[10px] font-mono font-bold uppercase text-red-500 tracking-widest bg-red-900/10 rounded border border-red-900/20 opacity-70 cursor-not-allowed">
                            SIGNAL LOST
                        </div>
                    ) : (
                        <button 
                        onClick={() => setActiveGame(signal)}
                        className="w-full py-2 mt-1 bg-[var(--ds-gray-900)] hover:bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)] text-[10px] font-mono font-bold uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2"
                        >
                        <ShieldAlert className="w-3 h-3" />
                        Decrypt
                        </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal Render */}
      {activeGame && (
        <DecryptionMinigame 
          signal={activeGame} 
          onComplete={handleComplete} 
          onClose={() => setActiveGame(null)} 
        />
      )}
    </>
  );
}

