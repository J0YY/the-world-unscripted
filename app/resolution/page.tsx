"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { TurnOutcome } from "@/engine";
import { Button, Card } from "@/components/ui";
import { getLastOutcome, getStoredGameId } from "@/components/storage";
import { apiResolutionReport } from "@/components/api";

type ResolutionReport = {
  turnNumber: number;
  directive: string | null;
  translatedActions: Array<{ kind: string; summary: string }>;
  publicResolution: string;
  consequences: string[];
  signalsUnknown: string[];
  deltas: Array<{ label: string; before: number; after: number; delta: number }>;
  actorShifts: Array<{ actor: string; posture: string; trustDelta: number; escalationDelta: number }>;
  threats: string[];
  llm?: {
    headline: string;
    narrative: string[];
    directiveImpact: Array<{
      directiveFragment: string;
      translatedOps: string[];
      observedEffects: string[];
    }>;
    perceptions: Array<{ actor: string; posture: "hostile" | "neutral" | "friendly"; read: string }>;
    threats: string[];
    nextMoves: string[];
  };
};

export default function ResolutionPage() {
  const router = useRouter();
  const outcome = getLastOutcome<TurnOutcome>();
  const gameId = getStoredGameId();
  const [report, setReport] = useState<ResolutionReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!outcome || !gameId) {
      router.push("/game");
      return;
    }
    apiResolutionReport(gameId, outcome.turnResolved)
      .then((r) => setReport(r as ResolutionReport))
      .catch((e) => setErr((e as Error).message));
  }, [outcome, gameId, router]);

  const title = useMemo(
    () => `Turn ${outcome?.turnResolved ?? "?"} — Resolution`,
    [outcome?.turnResolved],
  );

  if (!outcome) return <Shell title="Resolution">Loading…</Shell>;
  if (err) return <Shell title={title}>{err}</Shell>;
  if (!report) return <Shell title={title}>Compiling report…</Shell>;

  const headline = report.llm?.headline ?? "Resolution briefing";
  const narrative = report.llm?.narrative ?? outcome.publicResolutionText.split("\n").filter(Boolean);

  return (
    <Shell title={title}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
        <div className="text-xs tracking-widest text-white/50">AFTER-ACTION REPORT</div>
        <div className="mt-2 text-3xl font-semibold text-white">{headline}</div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="text-sm font-semibold text-white">Your directive</div>
            <div className="mt-3 rounded-lg bg-black/30 p-3 text-sm text-white/85 ring-1 ring-white/10 whitespace-pre-wrap">
              {report.directive?.trim() ? report.directive : "(no directive submitted)"}
            </div>

            <div className="mt-4 text-sm font-semibold text-white">Operations executed</div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
              {report.translatedActions.length ? (
                report.translatedActions.map((a, i) => <li key={`${i}-${a.summary}`}>{a.summary}</li>)
              ) : (
                <li>(none)</li>
              )}
            </ul>
          </Card>

          <Card>
            <div className="text-sm font-semibold text-white">Resolution narrative</div>
            <motion.ul
              className="mt-3 space-y-2"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
            >
              {narrative.slice(0, 18).map((line) => (
                <motion.li
                  key={line}
                  variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                  className="text-sm text-white/85"
                >
                  {line}
                </motion.li>
              ))}
            </motion.ul>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card>
            <div className="text-sm font-semibold text-white">Score changes</div>
            <div className="mt-3 space-y-2 text-sm text-white/80">
              {report.deltas.slice(0, 10).map((d) => (
                <div key={d.label} className="flex items-center justify-between gap-3">
                  <span className="text-white/75">{d.label}</span>
                  <span className="tabular-nums">
                    {d.before} → {d.after}{" "}
                    <span className={d.delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                      ({d.delta >= 0 ? "+" : ""}
                      {d.delta})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-sm font-semibold text-white">Perceptions</div>
            <div className="mt-3 space-y-2 text-sm text-white/80">
              {report.actorShifts.map((a) => (
                <div key={a.actor} className="flex items-center justify-between gap-3">
                  <span>{a.actor}</span>
                  <span className="tabular-nums text-white/70">
                    {a.posture} / trust {a.trustDelta >= 0 ? "+" : ""}
                    {a.trustDelta} / esc {a.escalationDelta >= 0 ? "+" : ""}
                    {a.escalationDelta}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-sm font-semibold text-white">Threats</div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
              {(report.llm?.threats ?? report.threats).slice(0, 6).map((t, i) => (
                <li key={`${i}-${t}`}>{t}</li>
              ))}
            </ul>
          </Card>
        </div>

        {report.llm?.directiveImpact?.length ? (
          <div className="mt-4">
            <Card>
              <div className="text-sm font-semibold text-white">How your directive changed the turn</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {report.llm.directiveImpact.slice(0, 6).map((d) => (
                  <div key={d.directiveFragment} className="rounded-lg bg-black/30 p-3 ring-1 ring-white/10">
                    <div className="text-xs tracking-widest text-white/50">FRAGMENT</div>
                    <div className="mt-1 text-sm text-white/90">{d.directiveFragment}</div>
                    <div className="mt-3 text-xs tracking-widest text-white/50">TRANSLATED OPS</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                      {d.translatedOps.length ? d.translatedOps.map((x) => <li key={x}>{x}</li>) : <li>(none)</li>}
                    </ul>
                    <div className="mt-3 text-xs tracking-widest text-white/50">OBSERVED EFFECTS</div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                      {d.observedEffects.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {report.llm?.nextMoves?.length ? (
          <div className="mt-4">
            <Card>
              <div className="text-sm font-semibold text-white">Recommended next moves</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
                {report.llm.nextMoves.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Card>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={() => router.push("/game")}>
            Back to control room
          </Button>
          <Button onClick={() => router.push(outcome.failure ? "/failure" : "/game")}>Proceed</Button>
        </div>
      </motion.div>
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

