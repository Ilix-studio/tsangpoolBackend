import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import logger from "./logger";

export const generateToken = (payload: object): string => {
  // Verify secret exists
  if (!process.env.JWT_SECRET) {
    logger.error("JWT secret is not configured");
    throw new Error("JWT secret is not configured");
  }

  try {
    const options: SignOptions = {
      expiresIn: (process.env.JWT_EXPIRE || "15m") as SignOptions["expiresIn"],
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, options);

    // Log token generation (first few characters only)
    logger.debug("Token generated successfully:", {
      payload,
      tokenPrefix: token.substring(0, 10) + "...",
    });

    return token;
  } catch (error) {
    logger.error("Token generation failed:", error);
    throw new Error("Failed to generate authentication token");
  }
};

export const verifyToken = (token: string): jwt.JwtPayload => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT secret is not configured");
  }

  return jwt.verify(token, process.env.JWT_SECRET) as jwt.JwtPayload;
};

export const generateRefreshToken = (payload: object): string => {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    logger.error("Refresh token secret is not configured");
    throw new Error("Refresh token secret is not configured");
  }

  try {
    const options: SignOptions = {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN ||
        "30d") as SignOptions["expiresIn"],
    };

    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, options);
  } catch (error) {
    logger.error("Refresh token generation failed:", error);
    throw new Error("Failed to generate refresh token");
  }
};

export const verifyRefreshToken = (token: string): jwt.JwtPayload => {
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new Error("Refresh token secret is not configured");
  }

  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET) as jwt.JwtPayload;
};

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");
