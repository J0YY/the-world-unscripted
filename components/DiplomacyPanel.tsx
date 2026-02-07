"use client";

import { useState, useRef, useEffect } from "react";
import { Send, ArrowLeft, Globe, ShieldAlert, BadgeCheck } from "lucide-react";
import type { GameSnapshot, ForeignPower } from "@/engine";
import { motion, AnimatePresence } from "framer-motion";

export default function DiplomacyPanel({ snapshot, gameId }: { snapshot: GameSnapshot; gameId: string }) {
  const [selectedNationId, setSelectedNationId] = useState<string | null>(null);

  if (!snapshot.diplomacy) {
    return (
      <div className="p-4 border border-[var(--ds-gray-alpha-200)] rounded bg-[var(--ds-gray-alpha-100)] text-xs text-[var(--ds-gray-500)] text-center font-mono">
        Diplomatic channels unavailable.
      </div>
    );
  }

  const selectedNation = selectedNationId
    ? snapshot.diplomacy.nations.find((n) => n.id === selectedNationId)
    : null;

  return (
    <div className="border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] rounded-lg overflow-hidden flex flex-col h-[500px]">
      <div className="px-4 py-3 border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] flex items-center justify-between">
        <h2 className="text-sm font-mono font-medium text-[var(--ds-gray-1000)] uppercase tracking-tight flex items-center gap-2">
          <Globe className="w-4 h-4" />
          Diplomatic Corps
        </h2>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {!selectedNation ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full overflow-y-auto p-2 space-y-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            >
              {snapshot.diplomacy.nations.map((nation) => (
                <button
                  key={nation.id}
                  onClick={() => setSelectedNationId(nation.id)}
                  className="w-full text-left p-3 rounded hover:bg-[var(--ds-gray-alpha-100)] border border-transparent hover:border-[var(--ds-gray-alpha-200)] transition group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-[var(--ds-gray-1000)]">{nation.name}</span>
                  </div>
                  <div className="text-xs text-[var(--ds-gray-900)] font-mono mb-2">
                    {nation.ministerName}
                  </div>
                  <div className="text-[10px] text-[var(--ds-gray-600)] line-clamp-2">
                    {nation.description}
                  </div>
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col"
            >
              <NationChat
                gameId={gameId}
                nation={selectedNation}
                onBack={() => setSelectedNationId(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StanceBadge({ stance }: { stance: number }) {
  let color = "bg-gray-100 text-gray-600 border-gray-200";
  let label = "Neutral";
  if (stance < 30) {
    color = "bg-red-950/20 text-red-400 border-red-900/30";
    label = "Hostile";
  } else if (stance > 70) {
    color = "bg-emerald-950/20 text-emerald-400 border-emerald-900/30";
    label = "Ally";
  }

  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono border ${color}`}
    >
      {label} ({stance})
    </span>
  );
}

function NationChat({
  gameId,
  nation,
  onBack,
}: {
  gameId: string;
  nation: ForeignPower;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>(
    nation.chatHistory || []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    setLoading(true);

    const optimMsg = { role: "user", text: msg };
    setMessages((prev) => [...prev, optimMsg]);

    try {
      const res = await fetch("/api/game/diplomacy/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, nationId: nation.id, message: msg }),
      });
      if (!res.ok) {
         throw new Error(`Server Error ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
         throw new Error(data.error);
      }
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "minister", text: data.reply }]);
        // Persist locally in case we leave/return within same turn
        nation.chatHistory = nation.chatHistory || [];
        nation.chatHistory.push({ role: "user", text: msg, timestamp: Date.now() });
        nation.chatHistory.push({ role: "minister", text: data.reply, timestamp: Date.now() });
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "system", text: "Connection lost. Secure channel failed." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="p-3 border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] flex items-center gap-3">
        <button onClick={onBack} className="p-1 hover:bg-[var(--ds-gray-alpha-200)] rounded">
          <ArrowLeft className="w-4 h-4 text-[var(--ds-gray-900)]" />
        </button>
        <div>
          <div className="text-xs font-bold text-[var(--ds-gray-1000)]">{nation.ministerName}</div>
          <div className="text-[10px] text-[var(--ds-gray-500)] font-mono">{nation.name}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="text-center mt-10 text-xs text-[var(--ds-gray-500)] italic">
            Secure line established.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]"
                  : m.role === "system"
                  ? "bg-red-500/10 text-red-500 w-full text-center font-mono"
                  : "bg-[var(--ds-gray-alpha-200)] text-[var(--ds-gray-1000)]"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
           <div className="flex justify-start">
              <div className="bg-[var(--ds-gray-alpha-100)] px-3 py-2 rounded-lg text-xs text-[var(--ds-gray-500)] animate-pulse">
                 Minister is typing...
              </div>
           </div>
        )}
      </div>

      <div className="p-3 bg-[var(--ds-background-100)] border-t border-[var(--ds-gray-alpha-200)]">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={`Message ${nation.ministerName}...`}
            disabled={loading}
            className="w-full bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded-md pl-3 pr-10 py-2 text-xs focus:border-[var(--ds-gray-400)] focus:outline-none transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="absolute right-1 top-1 p-1 text-[var(--ds-gray-900)] hover:text-[var(--ds-gray-1000)] disabled:opacity-30"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
