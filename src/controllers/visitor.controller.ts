// src/controllers/visitorController.ts
import { Request, Response } from "express";
import asyncHandler from "express-async-handler";

import logger from "../utils/logger";
import VisitorModel from "../models/visitor";

/**
 * @desc    Increment visitor count
 * @route   POST /api/visitor/increment-counter
 * @access  Public
 */
export const incrementVisitorCount = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Get or create visitor counter document
      let visitorData = await VisitorModel.findOne();

      if (!visitorData) {
        // Create new visitor counter if it doesn't exist
        visitorData = await VisitorModel.create({
          totalVisitors: 1,
          lastVisit: new Date(),
          dailyVisits: [
            {
              date: new Date(),
              count: 1,
            },
          ],
        });
      } else {
        // Increment total visitors
        visitorData.totalVisitors += 1;
        visitorData.lastVisit = new Date();

        // Update daily visits
        const today = new Date();
        const todayStart = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate()
        );

        // Find today's entry in dailyVisits array
        const todayEntry = visitorData.dailyVisits.find(
          (visit) => visit.date.toDateString() === todayStart.toDateString()
        );

        if (todayEntry) {
          // Update today's count
          todayEntry.count += 1;
        } else {
          // Add new day entry
          visitorData.dailyVisits.push({
            date: todayStart,
            count: 1,
          });

          // Keep only last 30 days of data
          if (visitorData.dailyVisits.length > 30) {
            visitorData.dailyVisits = visitorData.dailyVisits
              .sort((a, b) => b.date.getTime() - a.date.getTime())
              .slice(0, 30);
          }
        }

        await visitorData.save();
      }

      // Get client IP for logging (optional)
      const clientIP = req.ip || req.connection.remoteAddress || "unknown";

      logger.info(
        `Visitor count incremented to ${visitorData.totalVisitors} from IP: ${clientIP}`
      );

      res.status(200).json({
        success: true,
        count: visitorData.totalVisitors,
        message: "Visitor count incremented successfully",
      });
    } catch (error) {
      logger.error("Error incrementing visitor count:", error);
      res.status(500).json({
        success: false,
        error: "Failed to increment visitor count",
      });
    }
  }
);

/**
 * @desc    Get current visitor count
 * @route   GET /api/visitor/visitor-count
 * @access  Public
 */
export const getVisitorCount = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const visitorData = await VisitorModel.findOne();

      if (!visitorData) {
        // Return 0 if no data exists yet
        res.status(200).json({
          success: true,
          count: 0,
        });
        return;
      }

      res.status(200).json({
        success: true,
        count: visitorData.totalVisitors,
      });
    } catch (error) {
      logger.error("Error getting visitor count:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get visitor count",
      });
    }
  }
);

/**
 * @desc    Get visitor statistics for admin dashboard
 * @route   GET /api/visitor/stats
 * @access  Private/Admin
 */
export const getVisitorStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const visitorData = await VisitorModel.findOne();

      if (!visitorData) {
        res.status(200).json({
          success: true,
          data: {
            totalVisitors: 0,
            todayVisitors: 0,
            lastVisit: null,
            dailyStats: [],
            weeklyStats: {
              thisWeek: 0,
              lastWeek: 0,
              growth: 0,
            },
          },
        });
        return;
      }

      // Calculate today's visitors
      const today = new Date();
      const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const todayEntry = visitorData.dailyVisits.find(
        (visit) => visit.date.toDateString() === todayStart.toDateString()
      );
      const todayVisitors = todayEntry ? todayEntry.count : 0;

      // Calculate weekly stats
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

      const thisWeekVisits = visitorData.dailyVisits
        .filter((visit) => visit.date >= weekAgo)
        .reduce((sum, visit) => sum + visit.count, 0);

      const lastWeekVisits = visitorData.dailyVisits
        .filter((visit) => visit.date >= twoWeeksAgo && visit.date < weekAgo)
        .reduce((sum, visit) => sum + visit.count, 0);

      const weeklyGrowth =
        lastWeekVisits > 0
          ? ((thisWeekVisits - lastWeekVisits) / lastWeekVisits) * 100
          : 0;

      // Prepare daily stats for chart (last 7 days)
      const dailyStats = visitorData.dailyVisits
        .filter((visit) => visit.date >= weekAgo)
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((visit) => ({
          date: visit.date.toISOString().split("T")[0], // YYYY-MM-DD format
          count: visit.count,
        }));

      res.status(200).json({
        success: true,
        data: {
          totalVisitors: visitorData.totalVisitors,
          todayVisitors,
          lastVisit: visitorData.lastVisit,
          dailyStats,
          weeklyStats: {
            thisWeek: thisWeekVisits,
            lastWeek: lastWeekVisits,
            growth: Math.round(weeklyGrowth * 100) / 100, // Round to 2 decimal places
          },
        },
      });
    } catch (error) {
      logger.error("Error getting visitor stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get visitor statistics",
      });
    }
  }
);

/**
 * @desc    Reset visitor count (Admin only)
 * @route   POST /api/visitor/reset
 * @access  Private/Admin
 */
export const resetVisitorCount = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const visitorData = await VisitorModel.findOne();

      if (!visitorData) {
        res.status(404).json({
          success: false,
          error: "No visitor data found to reset",
        });
        return;
      }

      // Reset the counter
      visitorData.totalVisitors = 0;
      visitorData.dailyVisits = [];
      visitorData.lastVisit = new Date();

      await visitorData.save();

      logger.info("Visitor count reset by admin");

      res.status(200).json({
        success: true,
        message: "Visitor count reset successfully",
        count: 0,
      });
    } catch (error) {
      logger.error("Error resetting visitor count:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reset visitor count",
      });
    }
  }
);
