"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FailureDetails } from "@/engine";
import { apiReset } from "@/components/api";
import { Button, Card } from "@/components/ui";
import { clearStoredGame, getLastFailure } from "@/components/storage";

export default function FailurePage() {
  const router = useRouter();
  const failure = useMemo(() => getLastFailure<FailureDetails>(), []);
  const [seconds, setSeconds] = useState(8);
  const [autoErr, setAutoErr] = useState<string | null>(null);

  async function reset() {
    try {
      await apiReset();
      clearStoredGame();
      router.push("/");
    } catch (e) {
      setAutoErr((e as Error).message);
    }
  }

  useEffect(() => {
    // Show the game-over screen briefly, then auto-reset back to landing.
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (seconds !== 0) return;
    void reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  return (
    <Shell title="Failure">
      <Card>
        <div className="text-xs tracking-widest text-white/50">POST-MORTEM</div>
        <div className="mt-2 text-2xl font-semibold text-white">{failure?.title ?? "Government terminated"}</div>
        <div className="mt-2 text-sm text-white/70">
          {failure?.type === "DOMESTIC_OUSTER"
            ? "You lost office. Formal removal, coup dynamics, or revolutionary collapse ended your agency."
            : failure?.type === "LOSS_OF_SOVEREIGNTY"
              ? "The state lost meaningful agency. Invasion/annexation or protectorate conditions removed decision-making power."
              : "The run ended. The system no longer considers you an effective decision-maker."}
        </div>
        <div className="mt-3 text-xs font-mono text-white/50">
          Returning to start in {seconds}s…
          {autoErr ? ` (auto-reset failed: ${autoErr})` : ""}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="text-sm font-semibold text-white">Primary drivers</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
            {(failure?.primaryDrivers?.length ? failure.primaryDrivers : ["—"]).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="mt-4 text-sm font-semibold text-white">Point of no return (best guess)</div>
          <div className="mt-2 text-sm text-white/70">{failure?.pointOfNoReturnGuess ?? "—"}</div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-white">Timeline (last 3 turns)</div>
          <div className="mt-3 space-y-3">
            {(failure?.lastTurns?.length ? failure.lastTurns : []).map((t) => (
              <div key={t.turn} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-xs text-white/60">Turn {t.turn}</div>
                <div className="mt-1 text-sm text-white">{t.headline}</div>
                <div className="mt-2 text-xs whitespace-pre-wrap text-white/70">{t.resolution}</div>
              </div>
            ))}
            {!failure?.lastTurns?.length ? (
              <div className="text-sm text-white/60">
                No timeline available in this tab (open the Resolution screen right after ending a turn).
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/")}>
          Back to Start
        </Button>
        <Button variant="danger" onClick={reset}>
          Reset now
        </Button>
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

