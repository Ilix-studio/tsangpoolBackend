// backend/middleware/recaptchaMiddleware.ts
import { Request, Response, NextFunction } from "express";

import logger from "../utils/logger";

export const verifyRecaptchaV2 = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.body.recaptchaToken;
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  // Bypass in development
  if (process.env.NODE_ENV === "development" || token === "test_token") {
    logger.info("reCAPTCHA bypassed in development mode");
    next();
    return;
  }

  if (!token) {
    res.status(400).json({
      success: false,
      message: "reCAPTCHA token is required",
    });
    return;
  }

  if (!secretKey) {
    logger.error("Missing RECAPTCHA_SECRET_KEY env var");
    res
      .status(500)
      .json({ success: false, message: "Server misconfiguration" });
    return;
  }

  try {
    // Verify reCAPTCHA v2 token with Google
    const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`;

    const response = await fetch(verificationUrl, {
      method: "POST",
    });

    const data = await response.json();

    if (!data.success) {
      logger.warn("reCAPTCHA v2 verification failed", {
        errorCodes: data["error-codes"],
      });
      res.status(400).json({
        success: false,
        message: "Invalid reCAPTCHA token",
        errorCodes: data["error-codes"],
      });
      return;
    }

    logger.info("reCAPTCHA v2 verification successful", {
      hostname: data.hostname,
    });

    next();
  } catch (error) {
    logger.error("reCAPTCHA v2 verification error:", error);
    res.status(500).json({
      success: false,
      message: "reCAPTCHA verification error",
    });
  }
};
