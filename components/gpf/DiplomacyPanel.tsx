"use client";

import { GameSnapshot } from "@/engine";

export default function DiplomacyPanel({ snapshot, gameId }: { snapshot: GameSnapshot, gameId: string }) {
  return (
    <div className="p-4 border border-[var(--ds-gray-alpha-200)] rounded bg-[var(--ds-gray-alpha-100)] font-mono text-sm text-[var(--ds-gray-900)]">
      <div className="font-semibold mb-2">Diplomatic Channels</div>
      <p className="text-[var(--ds-gray-500)] text-xs">
         Secure lines are currently encrypted.
      </p>
      {/* Placeholder content using snapshot if needed */}
      <div className="mt-4 opacity-50">
         Region: {snapshot.countryProfile.name}
      </div>
    </div>
  );
}
