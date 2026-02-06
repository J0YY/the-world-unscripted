"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TurnOutcome } from "@/engine";
import { Button, Card } from "@/components/ui";
import { getLastOutcome } from "@/components/storage";

export default function ResolutionPage() {
  const router = useRouter();
  const outcome = getLastOutcome<TurnOutcome>();

  useEffect(() => {
    if (!outcome) router.push("/game");
  }, [outcome, router]);

  if (!outcome) return <Shell title="Resolution">Loading…</Shell>;

  return (
    <Shell title={`Turn ${outcome.turnResolved} — Resolution`}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="text-sm font-semibold text-white">What happened</div>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-sm text-white/85 ring-1 ring-white/10">
            {outcome.publicResolutionText}
          </pre>
        </Card>
        <Card>
          <div className="text-sm font-semibold text-white">Consequences</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
            {outcome.consequences.slice(0, 8).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-4 text-sm font-semibold text-white">Signals & uncertainties</div>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-white/75">
            {outcome.signalsUnknown.slice(0, 6).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-5 flex items-center justify-end">
        <Button onClick={() => router.push(outcome.failure ? "/failure" : "/game")}>Proceed</Button>
      </div>
    </Shell>
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

