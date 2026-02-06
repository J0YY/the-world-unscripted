"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Terminal } from "lucide-react";
import { getStoredGameId } from "../storage";

type Message = {
  id: string;
  role: "user" | "agent";
  text: string;
};

export default function IntelChatbot({ llmMode }: { llmMode?: "ON" | "OFF" }) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "init", role: "agent", text: "Agency link established. Secure line ready. Awaiting query." },
  ]);
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
    
    const userMsg: Message = { id: Date.now().toString(), role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const gameId = getStoredGameId();
      if (!gameId) throw new Error("No game ID");

      const res = await fetch("/api/game/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, message: userMsg.text }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transmission failed");

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "agent", text: data.reply },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "agent", text: "ERR: Connection lost. " + (err as Error).message },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (llmMode !== "ON") return null;

  return (
    <div className="flex flex-col border-t border-[var(--ds-gray-alpha-200)] pt-4 mt-4">
      <div className="flex items-center gap-2 mb-3 text-[var(--ds-gray-900)]">
         <Terminal className="w-4 h-4" />
         <h2 className="text-xs font-mono font-medium tracking-tight uppercase">Intelligence Uplink</h2>
      </div>

      <div 
        ref={scrollRef}
        className="h-64 overflow-y-auto mb-3 space-y-3 pr-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div 
              className={`max-w-[90%] rounded px-2 py-1.5 text-xs font-mono ${
                m.role === "user" 
                  ? "bg-[var(--ds-gray-alpha-200)] text-[var(--ds-gray-1000)]" 
                  : "text-emerald-500/90 border-l-2 border-emerald-500/50 pl-2"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1 text-emerald-500/50 text-xs font-mono animate-pulse">
            <span>Decrypting response...</span>
          </div>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Query intelligence..."
          className="w-full bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-1000)] rounded px-3 py-2 text-xs font-mono text-[var(--ds-gray-1000)] placeholder-[var(--ds-gray-500)] focus:outline-none focus:border-[var(--ds-blue-500)] pr-8"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ds-gray-1000)] hover:text-[var(--ds-blue-500)] disabled:opacity-30 transition-colors"
        >
          <Send className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
