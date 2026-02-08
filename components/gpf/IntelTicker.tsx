"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/* ── IntelTicker ────────────────────────────────────────
 *  CNN-style scrolling headline strip.
 *  Feeds from snapshot.playerView.briefing.headlines.
 * ────────────────────────────────────────────────────── */

interface IntelTickerProps {
  /** Headline strings from the briefing */
  headlines: string[];
  /** Optional: custom speed in px/sec (default: 60) */
  speed?: number;
  /** Optional: pause on hover (default: true) */
  pauseOnHover?: boolean;
}

export default function IntelTicker({
  headlines,
  speed = 60,
  pauseOnHover = true,
}: IntelTickerProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [flash, setFlash] = useState(false);

  /* Flash on new headlines */
  const prevHeadlinesRef = useRef<string[]>(headlines);
  useEffect(() => {
    if (
      prevHeadlinesRef.current.length &&
      JSON.stringify(prevHeadlinesRef.current) !== JSON.stringify(headlines)
    ) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      prevHeadlinesRef.current = headlines;
      return () => clearTimeout(t);
    }
    prevHeadlinesRef.current = headlines;
  }, [headlines]);

  /* Measure content width for seamless loop */
  useEffect(() => {
    if (stripRef.current) {
      setContentWidth(stripRef.current.scrollWidth / 2);
    }
  }, [headlines]);

  if (!headlines.length) return null;

  const duration = contentWidth / speed;
  const separator = " ◆ ";

  /* We render the content twice for the seamless loop */
  const renderItems = () =>
    headlines.map((h, i) => (
      <span key={i} className="whitespace-nowrap">
        <span className="text-amber-500/70 mx-3 select-none">{separator}</span>
        <span>{h}</span>
      </span>
    ));

  return (
    <div
      className="relative w-full overflow-hidden border-y border-[var(--ds-gray-alpha-200)] bg-black/60 backdrop-blur-md"
      onMouseEnter={pauseOnHover ? () => setIsPaused(true) : undefined}
      onMouseLeave={pauseOnHover ? () => setIsPaused(false) : undefined}
    >
      {/* Flash overlay on new headlines */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key="ticker-flash"
            className="absolute inset-0 pointer-events-none z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.15, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(234,179,8,0.2) 50%, transparent)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Label badge */}
      <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center">
        <div className="flex items-center gap-1.5 bg-red-600 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white font-semibold">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          INTEL
        </div>
      </div>

      {/* Fade edges */}
      <div className="absolute left-[60px] top-0 bottom-0 w-8 bg-gradient-to-r from-black/60 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black/60 to-transparent z-10 pointer-events-none" />

      {/* Scrolling content */}
      <div className="pl-[70px] py-1.5">
        <motion.div
          ref={stripRef}
          className="flex items-center text-xs font-mono text-green-400/90 tracking-wide"
          animate={
            contentWidth > 0
              ? {
                  x: [0, -contentWidth],
                }
              : undefined
          }
          transition={
            contentWidth > 0
              ? {
                  x: {
                    duration,
                    ease: "linear",
                    repeat: Infinity,
                    repeatType: "loop",
                  },
                }
              : undefined
          }
          style={isPaused ? { animationPlayState: "paused" } : undefined}
        >
          {/* Double the content for seamless loop */}
          {renderItems()}
          {renderItems()}
        </motion.div>
      </div>
    </div>
  );
}
