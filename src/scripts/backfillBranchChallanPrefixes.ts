import mongoose from "mongoose";
import dotenv from "dotenv";
import Branch from "../models/Branch";
import { CounterModel } from "../models/Counter";
import { numberToLetters } from "../utils/spreadsheetLetters";

dotenv.config();

/**
 * One-off admin script: assigns each existing Branch a stable letter code
 * (challanPrefix) used as the prefix for B2B Sales challan numbers
 * (A0001, A0002, ... for the branch with prefix "A", independently
 * B0001, B0002, ... for "B", etc). Idempotent — skips branches that already
 * have a challanPrefix.
 *
 * Golaghat and Sarupathar are assigned "A" and "B" explicitly by name (a
 * deliberate business decision, not derived from creation order). Any other
 * branch gets the next letters in `createdAt` order via numberToLetters,
 * continuing the b2b_branch_prefix sequence so future new-branch
 * auto-assignment (see B2BSalesModel.ts's pre-save hook) picks up from the
 * right place.
 *
 *   npx ts-node src/scripts/backfillBranchChallanPrefixes.ts
 */
const EXPLICIT_ASSIGNMENTS: Record<string, string> = {
  golaghat: "A",
  sarupathar: "B",
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not configured");

  await mongoose.connect(uri);

  const branches = await Branch.find({}).sort({ createdAt: 1 });
  const usedPrefixes = new Set(
    branches.map((b) => b.challanPrefix).filter(Boolean) as string[],
  );

  let assignedCount = 0;

  // Pass 1: explicit name-based assignments (Golaghat -> A, Sarupathar -> B).
  for (const branch of branches) {
    if (branch.challanPrefix) continue;
    const nameLower = branch.branchName.toLowerCase();
    const explicitKey = Object.keys(EXPLICIT_ASSIGNMENTS).find((key) =>
      nameLower.includes(key),
    );
    if (!explicitKey) continue;

    const prefix = EXPLICIT_ASSIGNMENTS[explicitKey];
    if (usedPrefixes.has(prefix)) {
      console.warn(
        `Prefix "${prefix}" is already taken — skipping explicit assignment for "${branch.branchName}".`,
      );
      continue;
    }
    branch.challanPrefix = prefix;
    await branch.save();
    usedPrefixes.add(prefix);
    assignedCount++;
    console.log(`Assigned "${prefix}" to "${branch.branchName}" (explicit).`);
  }

  // Pass 2: remaining branches, oldest first, get the next free letter.
  let cursor = 0;
  const nextFreeLetter = (): string => {
    let candidate: string;
    do {
      cursor++;
      candidate = numberToLetters(cursor);
    } while (usedPrefixes.has(candidate));
    return candidate;
  };

  for (const branch of branches) {
    if (branch.challanPrefix) continue;
    const prefix = nextFreeLetter();
    branch.challanPrefix = prefix;
    await branch.save();
    usedPrefixes.add(prefix);
    assignedCount++;
    console.log(`Assigned "${prefix}" to "${branch.branchName}" (sequential).`);
  }

  // Keep the auto-assignment counter in sync with the highest letter handed
  // out here, so the next NEW branch (assigned lazily by B2BSalesModel's
  // pre-save hook) continues from the right point instead of colliding.
  await CounterModel.findOneAndUpdate(
    { _id: "b2b_branch_prefix" },
    { $max: { seq: cursor } },
    { upsert: true },
  );

  console.log(
    assignedCount > 0
      ? `Done — assigned challanPrefix to ${assignedCount} branch(es).`
      : "Done — every branch already had a challanPrefix, nothing to do.",
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed to backfill branch challan prefixes:", err);
  process.exit(1);
});
