"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSnapshot } from "@/engine";
import { apiCreateGame, apiLatestGame, apiReset, apiSnapshot } from "@/components/api";
import { clearStoredGame, getStoredGameId, setStoredGameId } from "@/components/storage";
import { AnimatedNoise } from "@/components/twi2/animated-noise";
import { BitmapChevron } from "@/components/twi2/bitmap-chevron";
import { ScrambleTextOnHover } from "@/components/twi2/scramble-text";
import { SplitFlapAudioProvider, SplitFlapMuteToggle, SplitFlapText } from "@/components/twi2/split-flap-text";
import type { LandingStep } from "@/components/twi2/hscroll-nav";

type Busy = null | "new" | "load" | "reset";

export default function LandingPage() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFadingToGame, setIsFadingToGame] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<LandingStep>("hero");

  const punchline = useMemo(() => {
    return "Power compounds. So does collapse. The world is your oyster.";
  }, []);

  useEffect(() => {
    // If a game is already in localStorage, allow quick entry into /game via Load button.
    const gameId = getStoredGameId();
    if (!gameId) return;
    apiSnapshot(gameId).then(setSnap).catch(() => {});
  }, []);

  async function fadeTo(path: string) {
    setIsFadingToGame(true);
    // Give the overlay time to ramp to black before navigating.
    await new Promise((r) => setTimeout(r, 900));
    router.push(path);
  }

  function scrollToStep(step: LandingStep) {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth || 0;
    const idx = step === "hero" ? 0 : step === "dossier" ? 1 : 2;
    el.scrollTo({ left: idx * w, behavior: "smooth" });
    setActive(step);
  }

  function continueForward() {
    if (active === "hero") return scrollToStep("dossier");
    if (active === "dossier") return scrollToStep("mandate");
    if (active === "mandate") return fadeTo("/game");
  }

  async function begin() {
    setBusy("new");
    setError(null);
    try {
      const snap = await apiCreateGame(seed || undefined);
      setStoredGameId(snap.gameId);
      setSnap(snap);
      scrollToStep("dossier");
    } finally {
      setBusy(null);
    }
  }

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const { snapshot } = await apiLatestGame();
      if (!snapshot) throw new Error("No saved game found.");
      setStoredGameId(snapshot.gameId);
      if (snapshot.status === "FAILED") {
        router.push("/failure");
      } else {
        await fadeTo("/game");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    try {
      await apiReset();
      clearStoredGame();
      setSnap(null);
      setSeed("");
      setError(null);
      scrollToStep("hero");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="twi2 relative min-h-screen bg-background text-foreground">
      <div className="grid-bg fixed inset-0 opacity-30" aria-hidden="true" />

      <div
        ref={scrollerRef}
        className="hide-scrollbar relative z-10 h-screen overflow-x-hidden overflow-y-hidden flex snap-x snap-mandatory scroll-smooth"
      >
        <Panel id="hero">
          <AnimatedNoise opacity={0.03} />
          <div className="w-full max-w-6xl px-6 md:px-12 pt-8 md:pt-10">
            <SplitFlapAudioProvider>
              <div className="relative">
                <div className="flex flex-col gap-0 ml-[5px]">
                  <SplitFlapText
                    text="THE UNSCRIPTED"
                    speed={70}
                    scale={0.52}
                    className="gap-[0.18em]"
                    // Tighten R–I and I–P in UNSCRIPTED.
                    kerningRightPx={{ 8: -10, 9: -8 }}
                  />
                  <SplitFlapText
                    text="WORLD ORDER"
                    speed={70}
                    scale={0.52}
                    // Extra room before leading W, and more space between W–O.
                    className="gap-[0.18em] -mt-16 md:-mt-20 pl-[40px]"
                    kerningRightPx={{ 0: 26 }}
                  />
                </div>
              </div>

              <div className="mt-2">
                <p className="font-mono text-xs md:text-sm text-muted-foreground leading-snug max-w-2xl">{punchline}</p>
              </div>

            {error ? (
              <div className="mt-6 border border-border/40 bg-card px-4 py-3 font-mono text-xs text-accent">
                {error}
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="border border-border/40 p-6 bg-card/60">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Begin Simulation</div>
                <p className="mt-4 font-mono text-xs text-muted-foreground leading-relaxed">
                  Optional seed. Same seed → same world generation. Leave blank for a fresh run.
                </p>
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="seed (optional)"
                  className="mt-4 w-full bg-background border border-border/50 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent"
                />
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={begin}
                    disabled={busy !== null}
                    className="group inline-flex items-center gap-3 border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest text-foreground hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50"
                  >
                    <ScrambleTextOnHover text={busy === "new" ? "Generating…" : "New Game"} as="span" duration={0.6} />
                    <BitmapChevron className="transition-transform duration-[400ms] ease-in-out group-hover:rotate-45" />
                  </button>
                  <button
                    type="button"
                    onClick={load}
                    disabled={busy !== null}
                    className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors duration-200 disabled:opacity-50"
                  >
                    Load existing
                  </button>
                </div>
              </div>

              <div className="border border-border/40 p-6 bg-card/40">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Reset</div>
                <p className="mt-4 font-mono text-xs text-muted-foreground leading-relaxed">
                  Deletes all local runs (true state + logs). Use this to restart cleanly.
                </p>
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50"
                  >
                    {busy === "reset" ? "Resetting…" : "Reset Simulation"}
                  </button>
                </div>
              </div>
            </div>

              <div className="mt-4" style={{ marginTop: "40px" }}>
                <SplitFlapMuteToggle />
              </div>
            </SplitFlapAudioProvider>
          </div>
        </Panel>

        <Panel id="dossier">
          <div className="w-full max-w-6xl px-6 md:px-12 pt-20 md:pt-28">
            <div className="mb-10">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">01 / Dossier</span>
              <h2 className="mt-4 font-[var(--font-bebas)] text-5xl md:text-7xl tracking-tight">
                {snap ? `YOU HAVE BEEN ASSIGNED ${snap.countryProfile.name.toUpperCase()}.` : "THE WORLD IS NOT NEUTRAL."}
              </h2>
              {snap ? (
                <div className="mt-6 max-w-2xl">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Initial dossier: geography and constraints
                  </div>
                  <p className="mt-4 font-mono text-sm text-muted-foreground leading-relaxed">{snap.countryProfile.geographySummary}</p>
                </div>
              ) : (
                <div className="mt-6 max-w-2xl">
                  
                  <p className="mt-4 font-mono text-sm text-muted-foreground leading-relaxed">
                    You lead a country that does not exist, surrounded by powers that do. Every decision reallocates power somewhere. Often
                    not to you.
                  </p>
                  <p className="mt-4 font-mono text-sm text-muted-foreground leading-relaxed">
                    You issue orders. The world responds. Sometimes later.
                  </p>
                </div>
              )}
            </div>

            {snap ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-border/40 bg-card/50 p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Neighbors</div>
                  <div className="mt-3 font-mono text-sm text-foreground/90">{snap.countryProfile.neighbors.join(", ")}</div>
                  <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Regime</div>
                  <div className="mt-3 font-mono text-sm text-foreground/90">{snap.countryProfile.regimeType}</div>

                  <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Strategic assets (relative)
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <DossierStat label="Oil/Gas" value={snap.countryProfile.resources.oilGas} />
                    <DossierStat label="Food" value={snap.countryProfile.resources.food} />
                    <DossierStat label="Rare earths" value={snap.countryProfile.resources.rareEarths} />
                    <DossierStat label="Industrial" value={snap.countryProfile.resources.industrialBase} />
                  </div>
                </div>

                <div className="border border-border/40 bg-card/50 p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Starting assessment</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <DossierSignal label="Economic stability" s={snap.countryProfile.startingAssessment.economicStability} />
                    <DossierSignal label="Legitimacy" s={snap.countryProfile.startingAssessment.legitimacy} />
                    <DossierSignal label="Unrest" s={snap.countryProfile.startingAssessment.unrest} />
                    <DossierSignal label="Intel clarity" s={snap.countryProfile.startingAssessment.intelClarity} />
                  </div>

                  <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Key vulnerabilities
                  </div>
                  <ul className="mt-4 space-y-2">
                    {snap.countryProfile.vulnerabilities.slice(0, 6).map((v) => (
                      <li key={v} className="font-mono text-xs text-muted-foreground leading-relaxed">
                        - {v}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-border/40 bg-card/50 p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">What you are doing</div>
                  <ul className="mt-4 space-y-2">
                    <li className="font-mono text-xs text-muted-foreground leading-relaxed">- Issue directives in natural language.</li>
                    <li className="font-mono text-xs text-muted-foreground leading-relaxed">
                      - Choose among imperfect options (intel is noisy; outcomes are systemic).
                    </li>
                    <li className="font-mono text-xs text-muted-foreground leading-relaxed">- Absorb the costs of war, sanctions, and coercion.</li>
                  </ul>
                </div>
                <div className="border border-border/40 bg-card/50 p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">How you lose</div>
                  <ul className="mt-4 space-y-2">
                    <li className="font-mono text-xs text-muted-foreground leading-relaxed">- You’re removed at home.</li>
                    <li className="font-mono text-xs text-muted-foreground leading-relaxed">- Your sovereignty collapses.</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center gap-6">
              <button
                type="button"
                onClick={() => scrollToStep("mandate")}
                className="group inline-flex items-center gap-3 border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest text-foreground hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50"
              >
                <ScrambleTextOnHover text={snap ? "Accept mandate" : "Continue"} as="span" duration={0.6} />
                <BitmapChevron className="transition-transform duration-[400ms] ease-in-out group-hover:rotate-45" />
              </button>
            </div>
          </div>
        </Panel>

        <Panel id="mandate">
          <div className="w-full max-w-6xl px-6 md:px-12 pt-20 md:pt-28">
            <div className="mb-10">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">02 / Mandate</span>
              <h2 className="mt-4 font-[var(--font-bebas)] text-5xl md:text-7xl tracking-tight">
                {snap ? "YOUR FIRST TURN BEGINS." : "LOSE LEGITIMACY. LOSE OFFICE."}
              </h2>
              {snap ? (
                <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground leading-relaxed">
                  You have a state, a clock, and rivals with better options than you. Stabilize first. Expand leverage second.
                </p>
              ) : (
                <p className="mt-6 max-w-2xl font-mono text-sm text-muted-foreground leading-relaxed">
                  You are judged by outcomes. Signals are noisy, intel is incomplete, and external actors move on timelines you don’t control.
                </p>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="border border-border/40 bg-card/50 p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Failure conditions</div>
                <ul className="mt-4 space-y-2">
                  <li className="font-mono text-xs text-muted-foreground leading-relaxed">- Domestic ouster (legitimacy collapse + elite/military fracture or unrest).</li>
                  <li className="font-mono text-xs text-muted-foreground leading-relaxed">- Loss of sovereignty (annexation/protectorate dynamics, capital control, or integrity collapse).</li>
                </ul>
              </div>
              <div className="border border-border/40 bg-card/50 p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Objective</div>
                <p className="mt-4 font-mono text-xs text-muted-foreground leading-relaxed">
                  Stabilize the state, manage alliances and adversaries, and expand your leverage. If you can build durable power, you can attempt to dominate the region and eventually the system. Nothing is free: war, sanctions, and propaganda all create second-order costs.
                </p>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => fadeTo("/game")}
                disabled={!snap}
                className="group inline-flex items-center gap-3 border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest text-foreground hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50"
              >
                <ScrambleTextOnHover text="Enter control room" as="span" duration={0.6} />
                <BitmapChevron className="transition-transform duration-[400ms] ease-in-out group-hover:rotate-45" />
              </button>
              <button
                type="button"
                onClick={() => scrollToStep("dossier")}
                className="group font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors duration-200 flex items-center gap-2"
              >
                <span className="transition-transform duration-300 group-hover:-translate-x-1">←</span>
                <ScrambleTextOnHover text="Back" as="span" duration={0.4} />
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="fixed bottom-8 right-8 md:bottom-12 md:right-12 z-50">
        <button
          type="button"
          onClick={continueForward}
          disabled={active === "mandate" && !snap}
          aria-label="Continue"
          className="group inline-flex items-center justify-center border border-border/60 px-4 py-2 text-muted-foreground hover:text-foreground hover:border-accent transition-colors disabled:opacity-50 bg-background/60 backdrop-blur-sm"
        >
          <BitmapChevron className="transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-hover:rotate-45" />
        </button>
      </div>

      <div
        className="fixed inset-0 z-[100] bg-black transition-opacity duration-[1800ms] ease-in-out pointer-events-none"
        style={{ opacity: isFadingToGame ? 1 : 0 }}
        aria-hidden="true"
      />

      {busy === "new" ? (
        <div className="fixed inset-0 z-[110] bg-background text-foreground flex items-center justify-center">
          <AnimatedNoise opacity={0.04} />
          <div className="px-6 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Simulation loading</div>
            <div className="mt-6 font-[var(--font-bebas)] text-5xl md:text-7xl tracking-tight">GENERATING WORLD</div>
            <div className="mt-4 font-mono text-xs text-muted-foreground">This can take ~10–20 seconds.</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DossierStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xs font-mono text-foreground/90 uppercase">{value}</div>
    </div>
  );
}

function DossierSignal({
  label,
  s,
}: {
  label: string;
  s: { level: string; confidence: "low" | "med" | "high"; note?: string };
}) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs font-mono text-foreground/90">
        <span className="uppercase">{s.level}</span>
        <span className="text-muted-foreground">conf {s.confidence}</span>
      </div>
      {s.note ? <div className="mt-1 text-[10px] font-mono text-muted-foreground/90">{s.note}</div> : null}
    </div>
  );
}

function Panel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      className="relative snap-start w-screen h-screen flex items-start flex-shrink-0 overflow-hidden"
    >
      {children}
    </section>
  );
}
