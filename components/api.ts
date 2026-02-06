import type { GameSnapshot, PlayerAction, TurnOutcome } from "@/engine";

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? String((data as { error: string }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function apiCreateGame(seed?: string): Promise<GameSnapshot> {
  return jsonFetch<GameSnapshot>("/api/game/new", { method: "POST", body: JSON.stringify({ seed }) });
}

export async function apiLatestGame(): Promise<{ snapshot: GameSnapshot | null }> {
  return jsonFetch<{ snapshot: GameSnapshot | null }>("/api/game/latest");
}

export async function apiSnapshot(gameId: string): Promise<GameSnapshot> {
  return jsonFetch<GameSnapshot>(`/api/game/snapshot?gameId=${encodeURIComponent(gameId)}`);
}

export async function apiSubmitTurn(gameId: string, actions: PlayerAction[]): Promise<TurnOutcome> {
  return jsonFetch<TurnOutcome>("/api/game/submit-turn", {
    method: "POST",
    body: JSON.stringify({ gameId, actions }),
  });
}

export async function apiSubmitTurnWithDirective(
  gameId: string,
  actions: PlayerAction[],
  directive: string,
): Promise<TurnOutcome> {
  return jsonFetch<TurnOutcome>("/api/game/submit-turn", {
    method: "POST",
    body: JSON.stringify({ gameId, actions, directive }),
  });
}

export async function apiReset(): Promise<void> {
  await jsonFetch("/api/game/reset", { method: "POST", body: JSON.stringify({}) });
}

