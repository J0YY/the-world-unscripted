"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Dice5 } from "lucide-react";
import { motion } from "framer-motion";
import type { GameSnapshot } from "@/engine";

export function PromptConsole({
  gameId,
  llmMode,
  snapshot,
  onSubmitDirective,
}: {
  gameId: string;
  llmMode?: "ON" | "OFF";
  snapshot: GameSnapshot;
  onSubmitDirective: (directive: string) => Promise<void>;
}) {
  const [directive, setDirective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [heightVh, setHeightVh] = useState<number>(() => {
    if (typeof window === "undefined") return 22;
    const raw = window.localStorage.getItem("twuo:commandDeckHeightVh");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.max(18, Math.min(60, n)) : 28;
  });
  const dragRef = useRef<{ startY: number; startVh: number; dragging: boolean } | null>(null);

  const placeholder = useMemo(
    () =>
      "Type your directive. Be specific about what you want to achieve, who you want to influence, and what you want to happen next.",
    [],
  );

  useEffect(() => {
    // Keep page layout in sync with resizable height.
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--prompt-console-h", `${heightVh}vh`);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("twuo:commandDeckHeightVh", String(heightVh));
    }
  }, [heightVh]);

  async function submit() {
    if (!directive.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmitDirective(directive.trim());
      setDirective("");
    } finally {
      setSubmitting(false);
    }
  }

  const autoFillOptions = useMemo(() => {
    const c = snapshot.countryProfile.name;
    const n1 = snapshot.countryProfile.neighbors?.[0] ?? "a neighbor";
    const n2 = snapshot.countryProfile.neighbors?.[1] ?? "another neighbor";
    const h = String(snapshot.playerView.briefing.headlines?.[0] || "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    return [
      `Announce fuel + staples relief; open IMF backchannel; task intel to trace: "${h}".`,
      `Offer EU inspections-for-sanctions pause; tighten port + border controls; move reserves vs ${n1}.`,
      `Fire the finance minister; freeze bread + fuel prices for 14 days; arrest one flagship profiteer.`,
      `Secure emergency shipments; deploy crowd-control to the capital; open a hotline with ${n2}.`,
      `Propose a 7-day stand-down corridor; demand trade-route guarantees; prep retaliation plan.`,
    ];
  }, [snapshot.countryProfile.name, snapshot.countryProfile.neighbors, snapshot.playerView.briefing.headlines]);

  function autofill() {
    const pick = autoFillOptions[Math.floor(Math.random() * autoFillOptions.length)] ?? "";
    if (!pick) return;
    setDirective(pick);
  }

  function onResizePointerDown(e: React.PointerEvent) {
    // Left-click / primary touch only.
    if (typeof (e as unknown as { button?: number }).button === "number" && (e as unknown as { button: number }).button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    dragRef.current = { startY, startVh: heightVh, dragging: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current?.dragging) return;
      const dy = ev.clientY - dragRef.current.startY;
      const deltaVh = (-dy / window.innerHeight) * 100;
        const next = Math.max(18, Math.min(60, dragRef.current.startVh + deltaVh));
      setHeightVh(Number(next.toFixed(2)));
    };
    const onUp = () => {
      if (dragRef.current) dragRef.current.dragging = false;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      className="prompt-console fixed inset-x-0 bottom-0 z-[60] border-t border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/90 backdrop-blur overflow-hidden"
      style={{ height: `${heightVh}vh` }}
    >
      <div
        role="separator"
        aria-label="Resize command deck"
        onPointerDown={onResizePointerDown}
        className="absolute top-0 inset-x-0 h-3 cursor-ns-resize"
      >
        <div className="mx-auto mt-1.5 h-1 w-12 rounded-full bg-[var(--ds-gray-alpha-300)]" />
      </div>
      {submitting ? (
        <motion.div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          aria-live="polite"
        >
          <div className="w-full max-w-xl px-6">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/60">Resolving turn</div>
            <div className="mt-4 text-4xl font-semibold text-white">GENERATING OUTCOME</div>
            <motion.ul
              className="mt-5 space-y-2 text-sm text-white/80 font-mono"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
            >
              {[
                "Interpreting directive…",
                "Selecting operations…",
                "Applying second-order effects…",
                "Updating perceptions…",
                "Compiling brief…",
              ].map((t) => (
                <motion.li key={t} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}>
                  - {t}
                </motion.li>
              ))}
            </motion.ul>
            <div className="mt-6 h-1 w-full bg-white/10 rounded overflow-hidden">
              <div className="h-full w-1/3 bg-white/60 animate-pulse" />
            </div>
            <div className="mt-3 text-xs text-white/50 font-mono">This can take ~10–20 seconds when AI is online.</div>
          </div>
        </motion.div>
      ) : null}
      <div className="mx-auto h-full w-full max-w-[1800px] px-4 md:px-6 pt-5 pb-3 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ds-gray-600)]">Directive</div>
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
            }}
            placeholder={placeholder}
            rows={4}
            className="mt-2 w-full flex-1 min-h-0 resize-none rounded bg-[var(--ds-background-100)] px-3 py-3 text-sm md:text-base leading-relaxed font-mono text-[var(--ds-gray-1000)] outline-none ring-1 ring-[var(--ds-gray-alpha-200)] placeholder:text-[var(--ds-gray-500)]"
            disabled={submitting}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-mono text-[var(--ds-gray-600)]">
              <span className="opacity-80">{llmMode === "ON" ? "AI ON" : "AI OFF"}</span>
              <span className="opacity-50"> · </span>
              <span className="opacity-80">Cmd/Ctrl+Enter to submit</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => autofill()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-3 py-2 text-xs font-mono text-[var(--ds-gray-900)] disabled:opacity-40"
              >
                <Dice5 className="h-3.5 w-3.5" />
                Autofill
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !directive.trim()}
                className="inline-flex items-center gap-2 rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)] px-3 py-2 text-xs font-mono text-[var(--ds-gray-1000)] disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                {submitting ? "Submitting…" : "End turn"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

