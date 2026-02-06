"use client";

import { useState } from "react";
import type { PlayerIncomingEvent } from "@/engine";
import { Badge, Button, Card } from "./ui";

export function EventsPanel({ events }: { events: PlayerIncomingEvent[] }) {
  const [selected, setSelected] = useState<PlayerIncomingEvent | null>(null);

  return (
    <Card className="h-full">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Incoming events</div>
        <div className="text-xs text-white/60">{events.length} items</div>
      </div>
      <div className="mt-3 space-y-2">
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelected(e)}
            className="w-full rounded-lg border border-white/10 bg-zinc-900/40 p-3 text-left hover:bg-zinc-900 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-white/70">{e.type.replaceAll("_", " ")}</div>
              <Badge>u{e.urgency}</Badge>
            </div>
            <div className="mt-1 text-sm text-white">{e.visibleDescription}</div>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-white">Details</div>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <div className="mt-2 text-xs text-white/70">
            <div>
              <span className="text-white/60">Actor:</span> {selected.actor}
            </div>
            <div>
              <span className="text-white/60">Urgency:</span> {selected.urgency}
            </div>
          </div>
          <div className="mt-2 text-sm text-white">{selected.visibleDescription}</div>
          {selected.playerChoicesHints?.length ? (
            <div className="mt-3">
              <div className="text-xs font-semibold text-white/80">Practical options</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-white/80">
                {selected.playerChoicesHints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

