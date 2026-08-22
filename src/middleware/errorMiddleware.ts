import { Request, Response, NextFunction } from "express";
import { CustomError } from "../types/error.types";
import logger from "../utils/logger";

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log the error
  logger.error(err.stack);

  // CRITICAL: Check if response has already been sent
  if (res.headersSent) {
    // If headers are already sent, delegate to the default Express error handler
    return next(err);
  }

  // Prefer the error's own statusCode (e.g. ErrorResponse from auth/validation
  // failures); fall back to whatever res.statusCode was already set to, or 500.
  const statusCode = err.statusCode ?? (res.statusCode === 200 ? 500 : res.statusCode);

  try {
    // Send error response
    res.status(statusCode).json({
      success: false,
      message: err.message,
      stack: process.env.NODE_ENV === "production" ? null : err.stack,
    });
  } catch (responseError) {
    // If we still can't send the response, log it and delegate to Express
    logger.error("Failed to send error response:", responseError);
    return next(err);
  }
};

export const routeNotFound = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Handle favicon requests silently
  if (req.originalUrl === "/favicon.ico") {
    if (!res.headersSent) {
      res.status(204).end();
    }
    return;
  }

  // CRITICAL: Check if response has already been sent
  if (res.headersSent) {
    return next();
  }

  // Create error for route not found
  const error: CustomError = new Error(`Not Found - ${req.originalUrl}`);

  // Set status code and pass to error handler
  res.status(404);
  next(error);
};
