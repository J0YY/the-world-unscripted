"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameSnapshot } from "@/engine";
import { apiSnapshot } from "@/components/api";
import { Button, Card, Badge } from "@/components/ui";
import { getStoredGameId } from "@/components/storage";

export default function CountryProfilePage() {
  const router = useRouter();
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gameId = getStoredGameId();
    if (!gameId) {
      router.push("/");
      return;
    }
    apiSnapshot(gameId)
      .then(setSnap)
      .catch((e) => setError((e as Error).message));
  }, [router]);

  if (error) return <Shell title="Country profile">{error}</Shell>;
  if (!snap) return <Shell title="Country profile">Loading…</Shell>;

  const c = snap.countryProfile;

  return (
    <Shell title="Country profile">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-xs tracking-widest text-white/50">COUNTRY CARD</div>
          <div className="mt-2 text-2xl font-semibold text-white">{c.name}</div>
          <div className="mt-2 text-sm text-white/70">{c.geographySummary}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Regime: {c.regimeType}</Badge>
            <Badge>Neighbors: {c.neighbors.join(", ")}</Badge>
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-white">Resources & constraints</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/80">
            <Stat label="Oil/Gas" value={c.resources.oilGas} />
            <Stat label="Food" value={c.resources.food} />
            <Stat label="Rare earths" value={c.resources.rareEarths} />
            <Stat label="Industrial base" value={c.resources.industrialBase} />
          </div>
          <div className="mt-4">
            <div className="text-xs font-semibold text-white/75">Key vulnerabilities</div>
            <ul className="mt-2 list-disc pl-5 text-sm text-white/75">
              {c.vulnerabilities.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="mt-5 flex items-center justify-end">
        <Button onClick={() => router.push("/game")}>Assume Office</Button>
      </div>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black px-6 py-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="text-xs tracking-widest text-white/50">THE UNSCRIPTED WORLD ORDER</div>
        <div className="mt-2 text-2xl font-semibold text-white">{title}</div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

