import { cronJobs, makeFunctionReference, type FunctionReference } from "convex/server";

type AccrualBatchArgs = {
  cursor?: string | null;
  numItems?: number;
  employeePageSize?: number;
  asOf?: number;
};

type AccrualBatchResult = {
  continueCursor: string;
  isDone: boolean;
  scheduledCount: number;
};

const materializeAccrualBatch = makeFunctionReference<
  "mutation",
  AccrualBatchArgs,
  AccrualBatchResult
>("leaveAccrual:materializeOrganizationAccrualBatch") as unknown as FunctionReference<
  "mutation",
  "internal",
  AccrualBatchArgs,
  AccrualBatchResult
>;

const crons = cronJobs();

crons.daily(
  "materialize daily leave accruals",
  { hourUTC: 16, minuteUTC: 15 },
  materializeAccrualBatch,
  {},
);

export default crons;
