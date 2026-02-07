"use client";

import type React from "react";
import { SplitFlapAudioProvider, SplitFlapMuteToggle } from "@/components/twi2/split-flap-text";

export default function GlobalAudioShell({ children }: { children: React.ReactNode }) {
  return (
    <SplitFlapAudioProvider>
      {children}
      {/* Top-right HUD: keep this left of the AI pill (which sits at top-right). */}
      <div className="fixed top-4 right-4 z-[1000] pointer-events-auto -translate-x-[120px]">
        <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/35 backdrop-blur-md px-2 py-1">
          <SplitFlapMuteToggle className="text-[10px]" />
        </div>
      </div>
    </SplitFlapAudioProvider>
  );
}

