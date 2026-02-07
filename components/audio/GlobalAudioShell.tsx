"use client";

import type React from "react";
import { SplitFlapAudioProvider, SplitFlapMuteToggle } from "@/components/twi2/split-flap-text";

export default function GlobalAudioShell({ children }: { children: React.ReactNode }) {
  return (
    <SplitFlapAudioProvider>
      {children}
      <div className="fixed top-4 left-4 z-[1000] pointer-events-auto">
        <div className="rounded border border-[var(--ds-gray-alpha-200)] bg-[var(--ds-background-100)]/70 backdrop-blur px-2 py-1">
          <SplitFlapMuteToggle className="text-[10px]" />
        </div>
      </div>
    </SplitFlapAudioProvider>
  );
}

