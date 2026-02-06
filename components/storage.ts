export const STORAGE_KEYS = {
  gameId: "wuwo_gameId",
  lastOutcome: "wuwo_lastOutcome",
  lastFailure: "wuwo_lastFailure",
} as const;

export function getStoredGameId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEYS.gameId);
}

export function setStoredGameId(gameId: string): void {
  window.localStorage.setItem(STORAGE_KEYS.gameId, gameId);
}

export function clearStoredGame(): void {
  window.localStorage.removeItem(STORAGE_KEYS.gameId);
  window.sessionStorage.removeItem(STORAGE_KEYS.lastOutcome);
  window.sessionStorage.removeItem(STORAGE_KEYS.lastFailure);
}

export function setLastOutcome(outcome: unknown): void {
  window.sessionStorage.setItem(STORAGE_KEYS.lastOutcome, JSON.stringify(outcome));
}

export function getLastOutcome<T>(): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEYS.lastOutcome);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setLastFailure(failure: unknown): void {
  window.sessionStorage.setItem(STORAGE_KEYS.lastFailure, JSON.stringify(failure));
}

export function getLastFailure<T>(): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEYS.lastFailure);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

