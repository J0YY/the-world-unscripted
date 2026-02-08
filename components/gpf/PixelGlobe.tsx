"use client";

import { useEffect, useRef } from "react";

/**
 * A pixelated wireframe globe that slowly spins.
 * Pure canvas — no dependencies, matches the game's monochrome-green aesthetic.
 */
export default function PixelGlobe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    const PIXEL = 3; // pixel block size

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      // Always base radius on the shorter axis so the globe stays circular
      const r = Math.min(w, h) / 2 - 8;

      ctx.clearRect(0, 0, w, h);

      angleRef.current += 0.006;
      const rot = angleRef.current;

      // Draw pixelated globe
      const cols = Math.floor(w / PIXEL);
      const rows = Math.floor(h / PIXEL);

      for (let py = 0; py < rows; py++) {
        for (let px = 0; px < cols; px++) {
          const sx = px * PIXEL + PIXEL / 2 - cx;
          const sy = py * PIXEL + PIXEL / 2 - cy;
          const dist = Math.sqrt(sx * sx + sy * sy);

          if (dist > r + 1 || dist < r * 0.15) continue;

          // Map to sphere coords
          const lat = Math.asin(sy / r);
          const lonBase = Math.acos(Math.max(-1, Math.min(1, sx / (r * Math.cos(lat)))));
          const lon = (sx >= 0 ? lonBase : -lonBase) + rot;

          let hit = false;
          const alpha = dist <= r ? 1.0 : 0.0;
          if (alpha <= 0) continue;

          // Outline circle
          if (Math.abs(dist - r) < PIXEL * 1.2) {
            hit = true;
          }

          // Equator
          if (Math.abs(sy) < PIXEL * 0.8 && dist <= r) {
            hit = true;
          }

          // Meridians (every 45°)
          const normLon = ((lon % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          for (let m = 0; m < 8; m++) {
            const mAngle = (m * Math.PI) / 4;
            if (Math.abs(normLon - mAngle) < 0.08 && dist <= r) {
              hit = true;
              break;
            }
          }

          // Latitude lines (every 30°)
          const latDeg = (lat * 180) / Math.PI;
          for (let ll = -60; ll <= 60; ll += 30) {
            if (ll === 0) continue; // already drawn as equator
            const latY = r * Math.sin((ll * Math.PI) / 180);
            if (Math.abs(sy - latY) < PIXEL * 0.8) {
              // Only draw where point is inside sphere at that latitude
              const rAtLat = r * Math.cos((ll * Math.PI) / 180);
              if (Math.abs(sx) <= rAtLat) {
                hit = true;
                break;
              }
            }
          }

          if (hit) {
            // Brightness fades near edges (limb darkening)
            const limbFactor = dist <= r ? Math.sqrt(1 - (dist / r) ** 2) : 0.2;
            const brightness = 0.25 + limbFactor * 0.45;
            ctx.fillStyle = `rgba(74, 222, 128, ${brightness})`;
            ctx.fillRect(px * PIXEL, py * PIXEL, PIXEL - 1, PIXEL - 1);
          }
        }
      }

      // Subtle glow in center
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, "rgba(74, 222, 128, 0.03)");
      grd.addColorStop(1, "rgba(74, 222, 128, 0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded border border-[var(--ds-gray-alpha-200)] bg-black/40 ${className ?? ""}`}
    >
      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-20"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)",
        }}
      />
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
