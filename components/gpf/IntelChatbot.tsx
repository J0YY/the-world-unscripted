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
    <div className="flex flex-col h-[500px] border border-[var(--ds-gray-alpha-200)] rounded-lg overflow-hidden bg-[var(--ds-background-100)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ds-gray-alpha-200)] bg-[var(--ds-gray-alpha-100)] text-[var(--ds-gray-900)]">
         <Terminal className="w-4 h-4" />
         <h2 className="text-sm font-mono font-medium text-[var(--ds-gray-1000)] uppercase tracking-tight">Intelligence Uplink</h2>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div 
              className={`max-w-[90%] rounded px-3 py-2 text-xs font-mono leading-relaxed ${
                m.role === "user" 
                  ? "bg-[var(--ds-gray-1000)] text-[var(--ds-background-100)]" 
                  : "text-emerald-500/90 border-l-2 border-emerald-500/50 pl-3 bg-emerald-500/5"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-emerald-500/50 text-xs font-mono animate-pulse px-2">
            <span className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full" />
            <span>Decrypting response...</span>
          </div>
        )}
      </div>

      <div className="p-3 bg-[var(--ds-background-100)] border-t border-[var(--ds-gray-alpha-200)] relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Query intelligence..."
          className="w-full bg-[var(--ds-gray-alpha-100)] border border-[var(--ds-gray-alpha-200)] rounded text-xs font-mono text-[var(--ds-gray-1000)] placeholder-[var(--ds-gray-500)] focus:outline-none focus:border-[var(--ds-gray-400)] pl-3 pr-10 py-2.5 transition-colors"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--ds-gray-1000)] hover:text-[var(--ds-blue-500)] disabled:opacity-30 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
