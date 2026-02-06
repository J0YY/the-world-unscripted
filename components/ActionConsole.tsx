"use client";

import { useMemo, useState } from "react";
import type { ActionTemplate, ActorId, PlayerAction } from "@/engine";
import { Button, Card, Badge } from "./ui";

const ACTOR_IDS: ActorId[] = ["US", "EU", "CHINA", "RUSSIA", "REGIONAL_1", "REGIONAL_2"];

function categoryLabel(kind: PlayerAction["kind"]): string {
  return kind[0] + kind.slice(1).toLowerCase();
}

export function ActionConsole({
  templates,
  actionLimit,
  onSubmit,
}: {
  templates: ActionTemplate[];
  actionLimit: number;
  onSubmit: (actions: PlayerAction[], directive: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<PlayerAction["kind"]>("DIPLOMACY");
  const [selected, setSelected] = useState<PlayerAction[]>([]);
  const [directive, setDirective] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const byCategory = useMemo(() => {
    const m = new Map<PlayerAction["kind"], ActionTemplate[]>();
    for (const t of templates) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return m;
  }, [templates]);

  const tabTemplates = byCategory.get(tab) ?? [];

  function addTemplate(t: ActionTemplate) {
    if (selected.length >= actionLimit) return;
    setSelected((s) => [...s, structuredClone(t.defaultAction)]);
  }

  function removeAt(idx: number) {
    setSelected((s) => s.filter((_, i) => i !== idx));
  }

  function updateAt(idx: number, next: PlayerAction) {
    setSelected((s) => s.map((a, i) => (i === idx ? next : a)));
  }

  async function submit() {
    setSubmitting(true);
    try {
      await onSubmit(selected, directive);
      setSelected([]);
      setDirective("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="sticky bottom-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">Action Console</div>
        <div className="text-xs text-white/70">
          {selected.length}/{actionLimit} selected
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["DIPLOMACY", "ECONOMY", "MILITARY", "INTEL", "MEDIA", "INSTITUTIONS"] as const).map((k) => (
          <button
            key={k}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              tab === k ? "bg-white text-zinc-950" : "bg-white/10 text-white/85 hover:bg-white/15"
            }`}
            onClick={() => setTab(k)}
          >
            {categoryLabel(k)}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {tabTemplates.map((t) => (
          <button
            key={t.id}
            className="rounded-lg border border-white/10 bg-zinc-900/50 p-3 text-left hover:bg-zinc-900 transition disabled:opacity-50"
            disabled={selected.length >= actionLimit}
            onClick={() => addTemplate(t)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-white">{t.title}</div>
              <Badge>{t.category}</Badge>
            </div>
            <div className="mt-1 text-xs text-white/70">{t.description}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {selected.map((a, idx) => (
          <ActionEditor
            key={idx}
            action={a}
            onChange={(next) => updateAt(idx, next)}
            onRemove={() => removeAt(idx)}
          />
        ))}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-white/80">Freeform directive (optional)</div>
        <div className="mt-1 text-xs text-white/55">
          Write what you want to do in your own words. If server-side LLM is enabled, it will be translated into
          additional actions (within your remaining slots) and may influence next turn’s text.
        </div>
        <textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          rows={4}
          placeholder="Example: Quietly reassure the EU we’ll allow inspections, while preparing a limited mobilization and a targeted subsidy to prevent weekend unrest."
          className="mt-2 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/30"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={() => setSelected([])}
          disabled={selected.length === 0 || submitting}
        >
          Clear
        </Button>
        <Button onClick={submit} disabled={selected.length === 0 || submitting}>
          {submitting ? "Submitting…" : "End Turn"}
        </Button>
      </div>
    </Card>
  );
}

function ActionEditor({
  action,
  onChange,
  onRemove,
}: {
  action: PlayerAction;
  onChange: (next: PlayerAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-white/70">{action.kind}</div>
        <Button variant="danger" className="px-2 py-1 text-xs" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Intensity">
          <select
            className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
            value={action.intensity}
            onChange={(e) =>
              onChange({ ...action, intensity: Number(e.target.value) as 1 | 2 | 3 } as PlayerAction)
            }
          >
            <option value={1}>1 (low)</option>
            <option value={2}>2</option>
            <option value={3}>3 (high)</option>
          </select>
        </Field>
        <Field label="Visibility">
          <select
            className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
            value={action.isPublic ? "public" : "private"}
            onChange={(e) => onChange({ ...action, isPublic: e.target.value === "public" } as PlayerAction)}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </Field>

        {action.kind === "DIPLOMACY" ? (
          <>
            <Field label="Target actor">
              <select
                className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
                value={action.targetActor}
                onChange={(e) => onChange({ ...action, targetActor: e.target.value as ActorId })}
              >
                {ACTOR_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone">
              <select
                className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
                value={action.tone}
                onChange={(e) => onChange({ ...action, tone: e.target.value as typeof action.tone })}
              >
                <option value="conciliatory">Conciliatory</option>
                <option value="firm">Firm</option>
                <option value="hostile">Hostile</option>
              </select>
            </Field>
          </>
        ) : null}

        {action.kind === "MILITARY" ? (
          <Field label="Target actor (optional)">
            <select
              className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
              value={action.targetActor ?? ""}
              onChange={(e) => onChange({ ...action, targetActor: (e.target.value || undefined) as ActorId | undefined })}
            >
              <option value="">—</option>
              {ACTOR_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {action.kind === "INTEL" ? (
          <Field label="Target actor (optional)">
            <select
              className="w-full rounded-md bg-zinc-900 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10"
              value={action.targetActor ?? ""}
              onChange={(e) => onChange({ ...action, targetActor: (e.target.value || undefined) as ActorId | undefined })}
            >
              <option value="">—</option>
              {ACTOR_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <div className="text-xs text-white/70">{label}</div>
      {children}
    </label>
  );
}

