"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { X, ShieldAlert, BadgeAlert, Activity, User, MessageCircle, Send, Lock, Unlock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface InterrogationRoomProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onFailure?: () => void;
  targetCountry: string;
  objective: string;
}

type ChatMessage = {
  id: string;
  role: "interrogator" | "spy";
  text: string;
};

export default function InterrogationRoom({ isOpen, onClose, onSuccess, onFailure, targetCountry, objective }: InterrogationRoomProps) {
  const [pressure, setPressure] = useState(20);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"active" | "failed" | "success">("active");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [rewardClaimed, setRewardClaimed] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setPressure(20);
      setProgress(0);
      setStatus("active");
      setRewardClaimed(false);
      setMessages([
        { 
          id: "init", 
          role: "spy", 
          text: "I have nothing to say to you. You're wasting your time." 
        }
      ]);
    }
  }, [isOpen, targetCountry]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!input.trim() || isProcessing || status !== "active") return;

    const userText = input;
    setInput("");
    setIsProcessing(true);

    // Add user message
    const userMsg: ChatMessage = { 
      id: Date.now().toString(), 
      role: "interrogator", 
      text: userText 
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch("/api/game/interrogation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userText, 
          targetCountry,
          currentPressure: pressure,
          currentProgress: progress
        }),
      });

      if (!res.ok) {
        throw new Error("Connection failed");
      }

      const data = await res.json();
      
      // Update state based on AI response
      const newPressure = Math.max(0, Math.min(100, pressure + (data.pressureDelta || 0)));
      const newProgress = Math.max(0, Math.min(100, progress + (data.progressDelta || 0)));
      
      setPressure(newPressure);
      setProgress(newProgress);

      const spyMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "spy",
        text: data.reply
      };
      setMessages(prev => [...prev, spyMsg]);

      // Check win/loss conditions
      if (data.isBroken || newProgress >= 100) {
        setStatus("success");
        if (!rewardClaimed) {
          setRewardClaimed(true);
          setTimeout(() => onSuccess(), 2000); // Auto close after success
        }
      } else if (newPressure >= 100) {
        setStatus("failed");
        if (onFailure) setTimeout(() => onFailure(), 2500); // Auto close after failure
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: "spy", 
        text: "..." 
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl bg-black/90 p-4 animate-in fade-in duration-300">
      
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 h-[80vh]">
        {/* Left Panel: Subject Visual & Vitals */}
        <div className="md:col-span-1 flex flex-col gap-4">
          <div className="relative aspect-[3/4] w-full bg-black border border-neutral-800 rounded-lg overflow-hidden shrink-0 shadow-2xl">
             {/* Scanlines Effect */}
             <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-20 pointer-events-none bg-[length:100%_2px,3px_100%] pointer-events-none" />
             
             {/* Subject Image (Placeholder or Asset) */}
             <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                 <Image 
                    src="/interogate.png" 
                    alt="Subject"
                    fill
                    className={cn(
                       "object-cover transition-all duration-1000",
                       pressure > 80 ? "sepia-[0.2] contrast-125 rounded filter grayscale blur-[1px]" : "sepia-[0.3] contrast-105 rounded filter grayscale-[0.5]"
                    )}
                 />
                 <div className={cn(
                    "absolute inset-0 flex items-center justify-center transition-all duration-1000",
                    pressure > 80 ? "opacity-20 animate-pulse" : "opacity-0"
                 )}>
                    <User className="w-24 h-24 text-neutral-500" />
                 </div>
             </div>

             {/* Objective Overlay */}
             <div className="absolute bottom-4 left-4 right-4 bg-black/80 border border-neutral-700 p-3 rounded backdrop-blur z-30">
                <div className="text-[10px] text-red-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                   <BadgeAlert className="w-3 h-3" /> Mission Objective
                </div>
                <div className="text-xs text-neutral-300 font-mono leading-relaxed">
                   {objective}
                </div>
             </div>
             
             {/* Success/Fail Overlay */}
             {status === "success" && (
                <div className="absolute inset-0 bg-green-900/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                    <Unlock className="w-16 h-16 text-green-400 mb-4 animate-bounce" />
                    <h2 className="text-2xl font-bold text-green-100 tracking-widest uppercase">Intel Extracted</h2>
                    <p className="text-sm text-green-300 mt-2 font-mono">+15 Intelligence Clarity</p>
                    <p className="text-xs text-green-400/70 mt-4 font-mono uppercase tracking-widest animate-pulse">Updating Tactical Map...</p>
                </div>
             )}
             {status === "failed" && (
                <div className="absolute inset-0 bg-red-900/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                    <Zap className="w-16 h-16 text-red-400 mb-4" />
                    <h2 className="text-2xl font-bold text-red-100 tracking-widest uppercase">Subject Broken</h2>
                    <p className="text-sm text-red-300 mt-2 font-mono">Asset Lost. No Intel Gained.</p>
                </div>
             )}
             
             {/* Status Overlay */}
             <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-30">
               <div className="flex items-center gap-2 px-2 py-1 bg-black/60 border border-red-500/30 rounded text-xs font-mono text-red-400">
                  <BadgeAlert className="w-3 h-3" />
                  <span>sub_id: {targetCountry.slice(0,3).toUpperCase()}-882</span>
               </div>
               <div className="flex flex-col gap-1 items-end">
                  <div className="text-[10px] font-mono text-neutral-500">HEART RATE</div>
                  <div className={cn("text-xl font-mono font-bold flex items-center gap-1", 
                     pressure > 70 ? "text-red-500" : "text-green-500")}>
                     <Activity className="w-4 h-4 animate-pulse" />
                     {60 + Math.floor(pressure * 1.2)} BPM
                  </div>
               </div>
             </div>
          </div>

          {/* Metrics Panel */}
          <div className="flex-1 bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 space-y-6 font-mono">
             <div>
                <div className="flex justify-between text-xs mb-2 text-neutral-400">
                   <span>STRESS LEVEL</span>
                   <span className={pressure > 80 ? "text-red-500 font-bold" : ""}>{Math.round(pressure)}%</span>
                </div>
                <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                   <div 
                      className={cn("h-full transition-all duration-500", 
                        pressure > 80 ? "bg-red-600" : "bg-orange-500"
                      )}
                      style={{ width: `${pressure}%` }} 
                   />
                </div>
                <div className="mt-1 text-[10px] text-neutral-600">
                   Critical failure at 100% stress.
                </div>
             </div>

             <div>
                <div className="flex justify-between text-xs mb-2 text-neutral-400">
                   <span>INTEL EXTRACTED</span>
                   <span className="text-blue-400">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                   <div 
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${progress}%` }} 
                   />
                </div>
             </div>
          </div>
        </div>

        {/* Right Panel: Chat Interface */}
        <div className="md:col-span-2 flex flex-col bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden shadow-2xl">
           <div className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
              <div className="flex items-center gap-2">
                 <ShieldAlert className="w-4 h-4 text-red-500" />
                 <span className="font-mono text-sm tracking-widest text-neutral-300">INTERROGATION LOG // {targetCountry.toUpperCase()}</span>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-neutral-800 rounded text-neutral-500 hover:text-white transition">
                 <X className="w-5 h-5" />
              </button>
           </div>

           <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-950/50" ref={scrollRef}>
              {messages.map((msg) => (
                 <div key={msg.id} className={cn("flex", msg.role === "interrogator" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                       "max-w-[80%] rounded-lg p-3 text-sm font-mono leading-relaxed",
                       msg.role === "interrogator" 
                          ? "bg-neutral-800 text-neutral-200 border border-neutral-700" 
                          : "bg-red-950/20 text-red-200 border border-red-900/30"
                    )}>
                       <div className="text-[10px] opacity-50 mb-1 uppercase tracking-wider">
                          {msg.role === "interrogator" ? "You" : "Subject"}
                       </div>
                       {msg.text}
                    </div>
                 </div>
              ))}
              {status === "success" && (
                 <div className="flex justify-center my-4">
                    <div className="bg-green-900/20 border border-green-500/50 text-green-400 px-4 py-2 rounded text-sm font-mono animate-pulse">
                       SUCCESS: INTELLIGENCE SECURED
                    </div>
                 </div>
              )}
              {status === "failed" && (
                 <div className="flex justify-center my-4">
                    <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-4 py-2 rounded text-sm font-mono">
                       FAILURE: SUBJECT UNRESPONSIVE
                    </div>
                 </div>
              )}
           </div>

           <div className="p-4 bg-neutral-900 border-t border-neutral-800">
              {status === "active" ? (
                 <div className="flex gap-2">
                    <input
                       className="flex-1 bg-black border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-red-500 transition"
                       placeholder="Enter query or coercion..."
                       value={input}
                       onChange={(e) => setInput(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && handleSend()}
                       disabled={isProcessing}
                       autoFocus
                    />
                    <button 
                       onClick={handleSend}
                       disabled={isProcessing || !input.trim()}
                       className="bg-red-900/80 hover:bg-red-800 text-white px-4 rounded border border-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center w-12"
                    >
                       {isProcessing ? <Activity className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                 </div>
              ) : (
                 <div className="flex justify-center">
                    <button 
                       onClick={status === "success" ? onSuccess : onClose}
                       className={cn(
                          "px-6 py-2 rounded font-mono text-sm tracking-wider uppercase border transition hover:scale-105",
                          status === "success" 
                             ? "bg-green-600 border-green-400 text-white hover:bg-green-500" 
                             : "bg-neutral-800 border-neutral-600 text-neutral-300 hover:bg-neutral-700"
                       )}
                    >
                       {status === "success" ? "File Code & Close" : "Terminate Session"}
                    </button>
                 </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
}