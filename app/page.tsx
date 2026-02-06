"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiCreateGame, apiLatestGame, apiReset } from "@/components/api";
import { Button, Card } from "@/components/ui";
import { clearStoredGame, setStoredGameId } from "@/components/storage";

export default function StartPage() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState<null | "new" | "load" | "reset">(null);
  const tone = useMemo(
    () =>
      "You are President of a fictional state operating in the real international system. You will not see truth—only estimates, confidence, and imperfect signals. Reckless moves can end the government or the state.",
    [],
  );

  async function begin() {
    setBusy("new");
    try {
      const snap = await apiCreateGame(seed || undefined);
      setStoredGameId(snap.gameId);
      router.push("/country");
    } finally {
      setBusy(null);
    }
  }

  async function load() {
    setBusy("load");
    try {
      const { snapshot } = await apiLatestGame();
      if (!snapshot) throw new Error("No saved game found.");
      setStoredGameId(snapshot.gameId);
      router.push(snapshot.status === "FAILED" ? "/failure" : "/game");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    try {
      await apiReset();
      clearStoredGame();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs tracking-widest text-white/50">THE UNSCRIPTED WORLD ORDER</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Control room</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">{tone}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="text-sm font-semibold text-white">Begin simulation</div>
            <div className="mt-2 text-sm text-white/70">
              Optional seed (same seed → same world). Leave blank for a fresh run.
            </div>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="seed-optional"
              className="mt-3 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/30"
            />
            <div className="mt-4 flex gap-2">
              <Button onClick={begin} disabled={busy !== null}>
                {busy === "new" ? "Generating…" : "Begin Simulation"}
              </Button>
              <Button variant="secondary" onClick={load} disabled={busy !== null}>
                {busy === "load" ? "Loading…" : "Load Last Game"}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="text-sm font-semibold text-white">Reset simulation</div>
            <div className="mt-2 text-sm text-white/70">
              Deletes all local runs (true state + logs). Use this to restart cleanly.
            </div>
            <div className="mt-4">
              <Button variant="danger" onClick={reset} disabled={busy !== null}>
                {busy === "reset" ? "Resetting…" : "Reset Simulation"}
              </Button>
            </div>
            <div className="mt-3 text-xs text-white/50">
              Failure is explicit: domestic ouster or loss of sovereignty. War is allowed, but it is costly.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
