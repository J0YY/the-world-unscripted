"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type LandingStep = "hero" | "dossier" | "mandate";

const navItems: Array<{ id: LandingStep; label: string }> = [
  { id: "hero", label: "Index" },
  { id: "dossier", label: "Dossier" },
  { id: "mandate", label: "Mandate" },
];

export function HScrollNav({
  active,
  onSelect,
}: {
  active: LandingStep;
  onSelect: (id: LandingStep) => void;
}) {
  const items = useMemo(() => navItems, []);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <nav className="fixed left-0 top-0 z-50 h-screen w-16 md:w-20 hidden md:flex flex-col justify-center border-r border-border/30 bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col gap-6 px-4">
        {items.map(({ id, label }) => (
          <button key={id} onClick={() => onSelect(id)} className="group relative flex items-center gap-3" type="button">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-all duration-300",
                active === id ? "bg-accent scale-125" : "bg-muted-foreground/40 group-hover:bg-foreground/60",
              )}
            />
            <span
              className={cn(
                "absolute left-6 font-mono text-[10px] uppercase tracking-widest opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:left-8 whitespace-nowrap",
                active === id ? "text-accent" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

