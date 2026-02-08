"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/* ── WarRoomCinematic ──────────────────────────────────
 *  Between-turns cinematic: 4 short B&W video clips with
 *  grainy TV static flashes between each.
 *
 *  Place your MP4s in /public/cinematic/:
 *    globe.mp4, diplomats.mp4, stocks.mp4, military.mp4
 *
 *  Sequence:  globe → static → diplomats → static → stocks → static → military → out
 * ────────────────────────────────────────────────────── */

interface WarRoomCinematicProps {
  turn: number;
  active: boolean;
  onComplete: () => void;
  countryName?: string;
}

/* ── Segment definitions ── */
type Segment = { type: "video"; src: string; durationMs: number } | { type: "static"; durationMs: number };

const SEGMENTS: Segment[] = [
  { type: "video", src: "/cinematic/globe.mp4", durationMs: 3000 },
  { type: "static", durationMs: 500 },
  { type: "video", src: "/cinematic/diplomats.mp4", durationMs: 3000 },
  { type: "static", durationMs: 500 },
  { type: "video", src: "/cinematic/stocks.mp4", durationMs: 3000 },
  { type: "static", durationMs: 500 },
  { type: "video", src: "/cinematic/military.mp4", durationMs: 3000 },
];

/* ── Video captions ── */
const VIDEO_CAPTIONS: Record<string, string> = {
  "/cinematic/globe.mp4": "CHANGING THE WORLD",
  "/cinematic/diplomats.mp4": "DISRUPTING NORMS",
  "/cinematic/stocks.mp4": "SHIFTING THE BALANCE",
  "/cinematic/military.mp4": "PROJECTING FORCE",
};

/* ── Static / grain canvas ── */
function StaticGrain({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 320;
    canvas.height = 240;
    let animId = 0;

    const draw = () => {
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full object-cover ${className ?? ""}`}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

/* ── Typewriter caption ── */
function TypewriterCaption({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 55);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <span
      className="inline-block bg-black/90 px-5 md:px-8 py-3 md:py-4 text-2xl md:text-4xl lg:text-5xl tracking-[0.12em] uppercase text-white font-mono"
      style={{ borderLeft: "3px solid rgba(255,255,255,0.6)" }}
    >
      {displayed}
      <span className="animate-pulse ml-0.5 text-white/70">_</span>
    </span>
  );
}

export default function WarRoomCinematic({
  turn,
  active,
  onComplete,
  countryName,
}: WarRoomCinematicProps) {
  const [visible, setVisible] = useState(false);
  const [segIdx, setSegIdx] = useState(0);
  const cbRef = useRef(onComplete);
  cbRef.current = onComplete;
  const cancelledRef = useRef(false);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const setVideoRef = useCallback((src: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(src, el);
    else videoRefs.current.delete(src);
  }, []);

  /* ── Run the sequence ── */
  useEffect(() => {
    if (!active) {
      setVisible(false);
      setSegIdx(0);
      return;
    }

    cancelledRef.current = false;
    setSegIdx(0);
    setVisible(true);

    let idx = 0;

    const advance = () => {
      if (cancelledRef.current) return;

      const seg = SEGMENTS[idx];
      if (!seg) {
        // All segments done — start exit
        setVisible(false);
        setTimeout(() => cbRef.current(), 400);
        return;
      }

      setSegIdx(idx);

      // If it's a video segment, try to play it
      if (seg.type === "video") {
        const vid = videoRefs.current.get(seg.src);
        if (vid) {
          vid.currentTime = 0;
          vid.play().catch(() => {});
        }
      }

      setTimeout(() => {
        idx++;
        advance();
      }, seg.durationMs);
    };

    // Small delay to let the overlay fade in before first clip
    setTimeout(() => advance(), 200);

    return () => {
      cancelledRef.current = true;
    };
  }, [active]);

  const seg = SEGMENTS[segIdx];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="cinematic"
          className="fixed inset-0 z-[9999] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          {/* Black base */}
          <div className="absolute inset-0 bg-black" />

          {/* ── Preload all videos (hidden) ── */}
          {SEGMENTS.filter((s): s is Extract<Segment, { type: "video" }> => s.type === "video").map(
            (s) => (
              <video
                key={s.src}
                ref={(el) => setVideoRef(s.src, el)}
                src={s.src}
                muted
                playsInline
                preload="auto"
                className="hidden"
              />
            ),
          )}

          {/* ── Active segment ── */}
          <AnimatePresence mode="wait">
            {seg?.type === "video" && (
              <motion.div
                key={seg.src}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <video
                  src={seg.src}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{
                    filter: "grayscale(1) contrast(1.3) brightness(0.85)",
                    imageRendering: "pixelated",
                  }}
                />
                {/* Caption overlay — typewriter, off-center bottom-left */}
                {VIDEO_CAPTIONS[seg.src] && (
                  <motion.div
                    className="absolute bottom-14 md:bottom-20 left-6 md:left-12 z-30 pointer-events-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.3, ease: "easeOut" }}
                  >
                    <TypewriterCaption text={VIDEO_CAPTIONS[seg.src]!} />
                  </motion.div>
                )}
              </motion.div>
            )}

            {seg?.type === "static" && (
              <motion.div
                key={`static-${segIdx}`}
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.05 }}
              >
                <StaticGrain />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Scanline overlay ── */}
          <div
            className="absolute inset-0 pointer-events-none z-20 opacity-20"
            style={{
              background:
                "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.4) 2px, rgba(0,0,0,0.4) 4px)",
            }}
          />

          {/* ── Vignette ── */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)",
            }}
          />

          {/* ── Turn badge (bottom-right) ── */}
          <motion.div
            className="absolute bottom-6 right-6 z-30 flex items-center gap-2 font-mono"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">
              TURN
            </span>
            <span className="text-lg tabular-nums text-white/60">
              {String(turn).padStart(2, "0")}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
