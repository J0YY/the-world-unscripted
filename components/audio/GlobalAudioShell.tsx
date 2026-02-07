"use client";

import type React from "react";
import { usePathname } from "next/navigation";
import { SplitFlapAudioProvider, SplitFlapMuteToggle } from "@/components/twi2/split-flap-text";

export default function GlobalAudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isGame = pathname === "/game";

  return (
    <SplitFlapAudioProvider>
      {children}
      {/* Top-right HUD: keep this left of the AI pill (which sits at top-right). */}
      <div
        className={[
          "fixed top-4 right-4 z-[60] pointer-events-auto mix-blend-difference",
          // On /game, the AI pill occupies the far top-right; shift left to align beside it.
          isGame ? "-translate-x-[92px]" : "",
        ].join(" ")}
      >
        <SplitFlapMuteToggle variant="pill" />
      </div>
    </SplitFlapAudioProvider>
  );
}

