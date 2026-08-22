// models/Counter.ts
import mongoose, { Document, Schema } from "mongoose";

/**
 * Generic atomic sequence generator — no other model in this codebase uses
 * an atomic counter (JobCardInvoice/StockConcept id generation both use
 * racy countDocuments() scans). One document per named sequence; `seq`
 * starts at 0 and is only ever advanced via `nextSeq`.
 */
export interface ICounter extends Document {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const CounterModel = mongoose.model<ICounter>("Counter", CounterSchema);

/**
 * Atomically advances and returns the next value of the named sequence.
 * Safe under concurrent callers — `$inc` is a single atomic Mongo op, unlike
 * a countDocuments()-then-insert pattern.
 */
export async function nextSeq(counterName: string): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate(
    { _id: counterName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}
