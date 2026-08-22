// types/leave_types.ts
export const LEAVE_LIMITS = {
  Sick: 12,
  Casual: 12,
} as const;

export type LeaveType = keyof typeof LEAVE_LIMITS;

export interface LeaveBalanceResult {
  Sick: { total: number; used: number; remaining: number };
  Casual: { total: number; used: number; remaining: number };
}
