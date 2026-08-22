import { IRefreshTokenSession } from "../models/shared/refreshTokenSession";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parses simple "30d" / "15m" style env-var durations. Falls back on anything else. */
export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match) return fallbackMs;
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}

/** Drops sessions whose refresh token has already expired, so the array never grows unbounded and a stale entry can never be matched. */
export function pruneExpiredSessions(
  sessions: IRefreshTokenSession[] | undefined,
): IRefreshTokenSession[] {
  if (!sessions?.length) return [];
  const now = Date.now();
  return sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
}

/** Caps concurrent sessions per account — one account can't accumulate unbounded devices. */
export const MAX_SESSIONS_PER_USER = 5;

/** Prunes expired sessions, evicts the oldest if at the cap, then appends the new one — used at login for every role. */
export function appendSession(
  sessions: IRefreshTokenSession[] | undefined,
  tokenHash: string,
  userAgent: string | undefined,
): IRefreshTokenSession[] {
  const expiresAt = new Date(
    Date.now() +
      parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000),
  );
  const kept = pruneExpiredSessions(sessions).slice(-(MAX_SESSIONS_PER_USER - 1));
  return [...kept, { tokenHash, createdAt: new Date(), expiresAt, userAgent }];
}
