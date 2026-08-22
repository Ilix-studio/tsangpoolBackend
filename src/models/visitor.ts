// src/models/visitorModel.ts
import mongoose, { Document, Schema } from "mongoose";

// Interface for daily visit tracking
interface IDailyVisit {
  date: Date;
  count: number;
}

// Interface for the visitor document
export interface IVisitor extends Document {
  totalVisitors: number;
  lastVisit: Date;
  dailyVisits: IDailyVisit[];
  createdAt: Date;
  updatedAt: Date;
}

// Daily visit schema
const dailyVisitSchema = new Schema<IDailyVisit>({
  date: {
    type: Date,
    required: true,
  },
  count: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
});

// Main visitor schema
const visitorSchema = new Schema<IVisitor>(
  {
    totalVisitors: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lastVisit: {
      type: Date,
      default: Date.now,
    },
    dailyVisits: {
      type: [dailyVisitSchema],
      default: [],
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    collection: "visitors", // Specify collection name
  }
);

// Index for better query performance
visitorSchema.index({ "dailyVisits.date": 1 });

// Static method to get or create visitor data
visitorSchema.statics.getOrCreate = async function () {
  let visitor = await this.findOne();

  if (!visitor) {
    visitor = await this.create({
      totalVisitors: 0,
      lastVisit: new Date(),
      dailyVisits: [],
    });
  }

  return visitor;
};

// Instance method to increment count
visitorSchema.methods.incrementCount = async function () {
  this.totalVisitors += 1;
  this.lastVisit = new Date();

  // Update daily visits
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  // Find today's entry
  const todayEntry = this.dailyVisits.find(
    (visit: IDailyVisit) =>
      visit.date.toDateString() === todayStart.toDateString()
  );

  if (todayEntry) {
    todayEntry.count += 1;
  } else {
    this.dailyVisits.push({
      date: todayStart,
      count: 1,
    });

    // Keep only last 30 days
    if (this.dailyVisits.length > 30) {
      this.dailyVisits = this.dailyVisits
        .sort(
          (a: IDailyVisit, b: IDailyVisit) =>
            b.date.getTime() - a.date.getTime()
        )
        .slice(0, 30);
    }
  }

  return this.save();
};

// Instance method to get today's visitor count
visitorSchema.methods.getTodayCount = function () {
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const todayEntry = this.dailyVisits.find(
    (visit: IDailyVisit) =>
      visit.date.toDateString() === todayStart.toDateString()
  );

  return todayEntry ? todayEntry.count : 0;
};

// Instance method to get weekly stats
visitorSchema.methods.getWeeklyStats = function () {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeekVisits = this.dailyVisits
    .filter((visit: IDailyVisit) => visit.date >= weekAgo)
    .reduce((sum: number, visit: IDailyVisit) => sum + visit.count, 0);

  const lastWeekVisits = this.dailyVisits
    .filter(
      (visit: IDailyVisit) => visit.date >= twoWeeksAgo && visit.date < weekAgo
    )
    .reduce((sum: number, visit: IDailyVisit) => sum + visit.count, 0);

  const growth =
    lastWeekVisits > 0
      ? ((thisWeekVisits - lastWeekVisits) / lastWeekVisits) * 100
      : 0;

  return {
    thisWeek: thisWeekVisits,
    lastWeek: lastWeekVisits,
    growth: Math.round(growth * 100) / 100,
  };
};

// Export the model
const VisitorModel = mongoose.model<IVisitor>("Visitor", visitorSchema);
export default VisitorModel;
