import { CookieOptions } from "express";
import { parseDurationMs } from "../utils/tokenCleanup";

export const REFRESH_COOKIE_NAME = "refreshToken";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const getRefreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth",
  maxAge: parseDurationMs(process.env.REFRESH_TOKEN_EXPIRES_IN, THIRTY_DAYS_MS),
});
