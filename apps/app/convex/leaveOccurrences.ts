import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  buildLeaveOccurrenceDrafts,
  type LeaveOccurrenceDraft,
  type LeaveWeekSchedule,
} from "../lib/leave/duration-engine";
import {
  holidayAppliesToEmployee,
  holidayMatchesDate,
} from "../lib/payroll-calculations";

const MANILA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAX_HOLIDAYS_PER_ORGANIZATION = 500;
const MAX_POLICY_VERSIONS = 100;
const MAX_BALANCE_CANDIDATES = 100;
const MAX_QUALIFICATIONS = 100;
const MAX_EMPLOYEE_REQUESTS = 500;
const MAX_REQUEST_CALENDAR_DAYS = 366;

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
type DurationMode = "day" | "half_day" | "hour";

export type LeaveRequestV2DraftArgs = {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policyId: Id<"leavePolicies">;
  startLocalDate: string;
  endLocalDate: string;
  requestedDurationMode: DurationMode;
  requestedMinutes?: number;
  benefitEventId?: Id<"leaveBenefitEvents">;
};

export type LeaveOccurrencePreview = LeaveOccurrenceDraft & {
  holidayId?: Id<"holidays">;
  holidayType?: Doc<"holidays">["type"];
  shiftId?: Id<"shifts">;
};

export type PreparedLeaveRequestV2 = {
  settings: Doc<"organizationLeaveSettings">;
  employee: Doc<"employees">;
  policy: Doc<"leavePolicies">;
  policyVersion: Doc<"leavePolicyVersions">;
  balance: Doc<"employeeLeaveBalances"> | null;
  benefitEvent: Doc<"leaveBenefitEvents"> | null;
  requestedStart: number;
  requestedEnd: number;
  chargeableDuration: number;
  availableBalance: number | null;
  remainingBalance: number | null;
  occurrences: LeaveOccurrencePreview[];
};

export async function prepareLeaveRequestV2(
  ctx: DatabaseContext,
  args: LeaveRequestV2DraftArgs,
  now: number,
  options: {
    existingReservationUnits?: number;
    excludeLeaveRequestId?: Id<"leaveRequests">;
  } = {},
): Promise<PreparedLeaveRequestV2> {
  const requestedStart = localDateToManilaTimestamp(args.startLocalDate);
  const requestedEnd = localDateToManilaTimestamp(args.endLocalDate);
  if (requestedEnd < requestedStart) {
    throw new Error("Leave end date cannot be before the start date");
  }
  const requestedCalendarDays =
    Math.floor((requestedEnd - requestedStart) / DAY_MILLISECONDS) + 1;
  if (requestedCalendarDays > MAX_REQUEST_CALENDAR_DAYS) {
    throw new Error("Leave request exceeds the maximum supported span");
  }

  const [settings, employee, policy] = await Promise.all([
    requireActiveLeaveEngineV2(ctx, args.organizationId),
    ctx.db.get(args.employeeId),
    ctx.db.get(args.policyId),
  ]);
  if (!employee || employee.organizationId !== args.organizationId) {
    throw new Error("Employee not found in organization");
  }
  if (employee.employment.status !== "active") {
    throw new Error("Separated or inactive employees cannot create leave requests");
  }
  if (
    !policy ||
    policy.organizationId !== args.organizationId ||
    policy.state !== "active"
  ) {
    throw new Error("Active leave policy not found");
  }
  assertDurationPrecision(settings.requestPrecision, args);

  const policyVersion = await loadEffectivePolicyVersion(
    ctx,
    policy._id,
    requestedStart,
    requestedEnd,
  );
  assertCompletedService(employee, policyVersion, requestedStart);
  const benefitEvent = await validateEligibility(
    ctx,
    employee,
    policy,
    policyVersion,
    args.benefitEventId,
    requestedStart,
    requestedEnd,
  );
  const occurrences = await buildServerOccurrenceDrafts(ctx, {
    organizationId: args.organizationId,
    employee,
    policyVersion,
    startLocalDate: args.startLocalDate,
    endLocalDate: args.endLocalDate,
    requestedDurationMode: args.requestedDurationMode,
    requestedMinutes: args.requestedMinutes,
  });
  const chargeableDuration = roundDuration(
    occurrences.reduce((sum, occurrence) => sum + occurrence.creditUnits, 0),
  );
  if (chargeableDuration <= 0) {
    throw new Error("Leave period must include a chargeable day");
  }
  if (
    policyVersion.maximumConsecutiveUnits !== undefined &&
    chargeableDuration > policyVersion.maximumConsecutiveUnits
  ) {
    throw new Error("Leave request exceeds the maximum consecutive duration");
  }
  assertMinimumNotice(policyVersion, requestedStart, now);
  await assertEventLimits(
    ctx,
    employee,
    policy,
    policyVersion,
    benefitEvent,
    chargeableDuration,
    requestedStart,
    options.excludeLeaveRequestId,
  );

  const balance = await loadMatchingBalance(
    ctx,
    employee,
    policy,
    policyVersion,
    requestedStart,
    requestedEnd,
  );
  const availableBalance =
    balance === null
      ? null
      : balance.balance + (options.existingReservationUnits ?? 0);
  if (availableBalance !== null && availableBalance < chargeableDuration) {
    throw new Error("Insufficient leave balance");
  }

  return {
    settings,
    employee,
    policy,
    policyVersion,
    balance,
    benefitEvent,
    requestedStart,
    requestedEnd,
    chargeableDuration,
    availableBalance,
    remainingBalance:
      availableBalance === null
        ? null
        : roundDuration(availableBalance - chargeableDuration),
    occurrences,
  };
}

export async function insertLeaveRequestOccurrences(
  ctx: Pick<MutationCtx, "db">,
  args: {
    leaveRequestId: Id<"leaveRequests">;
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    payTreatment: Doc<"leavePolicyVersions">["payTreatment"];
    occurrences: readonly LeaveOccurrencePreview[];
    now: number;
  },
): Promise<void> {
  for (const occurrence of args.occurrences) {
    await ctx.db.insert("leaveRequestOccurrences", {
      leaveRequestId: args.leaveRequestId,
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      localDate: occurrence.localDate,
      scheduleSnapshot: {
        isWorkday: !occurrence.isRestDay,
        scheduledMinutes: occurrence.scheduledMinutes,
        shiftId: occurrence.shiftId,
      },
      holidaySnapshot: {
        isHoliday: occurrence.isHoliday,
        holidayId: occurrence.holidayId,
        holidayType: occurrence.holidayType,
      },
      scheduledMinutes: occurrence.scheduledMinutes,
      leaveMinutes: occurrence.leaveMinutes,
      creditAmount: occurrence.creditUnits,
      payTreatment: args.payTreatment,
      lifecycleState: "reserved",
      attendanceConflictState: "none",
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
}

export function localDateToManilaTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Leave dates must use YYYY-MM-DD format");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const utcTimestamp = Date.UTC(year, monthIndex, day);
  const parsed = new Date(utcTimestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Leave date is invalid");
  }
  return utcTimestamp - MANILA_OFFSET_MILLISECONDS;
}

function timestampToLocalDate(timestamp: number): string {
  const date = new Date(timestamp + MANILA_OFFSET_MILLISECONDS);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export async function requireActiveLeaveEngineV2(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings">> {
  const rows = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Duplicate organization leave settings");
  const settings = rows[0];
  if (
    !settings ||
    settings.migrationState !== "active" ||
    settings.activePolicyEngineVersion !== 2
  ) {
    throw new Error("Canonical leave engine is not active");
  }
  return settings;
}

async function loadEffectivePolicyVersion(
  ctx: DatabaseContext,
  policyId: Id<"leavePolicies">,
  requestedStart: number,
  requestedEnd: number,
): Promise<Doc<"leavePolicyVersions">> {
  const versions = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_effective", (query) =>
      query.eq("leavePolicyId", policyId).lte("effectiveStart", requestedStart),
    )
    .order("desc")
    .take(MAX_POLICY_VERSIONS + 1);
  if (versions.length > MAX_POLICY_VERSIONS) {
    throw new Error("Leave policy version history exceeds the supported limit");
  }
  const version = versions.find(
    (candidate) =>
      candidate.effectiveEnd === undefined ||
      candidate.effectiveEnd >= requestedEnd,
  );
  if (!version) throw new Error("No leave policy version covers the request");
  return version;
}

async function buildServerOccurrenceDrafts(
  ctx: DatabaseContext,
  args: {
    organizationId: Id<"organizations">;
    employee: Doc<"employees">;
    policyVersion: Doc<"leavePolicyVersions">;
    startLocalDate: string;
    endLocalDate: string;
    requestedDurationMode: DurationMode;
    requestedMinutes?: number;
  },
): Promise<LeaveOccurrencePreview[]> {
  const shift = args.employee.shiftId
    ? await ctx.db.get(args.employee.shiftId)
    : null;
  if (shift && shift.organizationId !== args.organizationId) {
    throw new Error("Employee shift organization mismatch");
  }
  const scheduleByWeekday = buildSchedule(args.employee, shift);
  const holidays = await loadApplicableHolidays(
    ctx,
    args.organizationId,
    args.employee,
    args.startLocalDate,
    args.endLocalDate,
  );
  const holidaysByDate = new Map(
    holidays.map((holiday) => [holiday.localDate, holiday] as const),
  );
  const holidayDates = new Set(holidaysByDate.keys());
  const initial = buildLeaveOccurrenceDrafts({
    startLocalDate: args.startLocalDate,
    endLocalDate: args.endLocalDate,
    durationBasis: args.policyVersion.durationBasis,
    requestedMinutesByDate: {},
    scheduleByWeekday,
    holidays: holidayDates,
  });

  let drafts = initial;
  if (args.requestedDurationMode !== "day") {
    if (args.startLocalDate !== args.endLocalDate) {
      throw new Error("Partial-day leave must be requested for one local date");
    }
    if (args.policyVersion.durationBasis !== "scheduled_work") {
      throw new Error("Partial-day leave is allowed only for scheduled-work policies");
    }
    const scheduledMinutes = initial[0]?.scheduledMinutes ?? 0;
    const requestedMinutes =
      args.requestedDurationMode === "half_day"
        ? scheduledMinutes / 2
        : args.requestedMinutes;
    if (
      requestedMinutes === undefined ||
      !Number.isInteger(requestedMinutes) ||
      requestedMinutes <= 0
    ) {
      throw new Error("Requested leave minutes must be a positive whole number");
    }
    drafts = buildLeaveOccurrenceDrafts({
      startLocalDate: args.startLocalDate,
      endLocalDate: args.endLocalDate,
      durationBasis: args.policyVersion.durationBasis,
      requestedMinutesByDate: { [args.startLocalDate]: requestedMinutes },
      scheduleByWeekday,
      holidays: holidayDates,
    });
  }

  return drafts.map((draft) => {
    const holiday = holidaysByDate.get(draft.localDate);
    const creditUnits =
      args.policyVersion.durationBasis === "scheduled_work"
        ? draft.creditUnits
        : draft.legalUnits;
    return {
      ...draft,
      creditUnits,
      holidayId: holiday?.holidayId,
      holidayType: holiday?.holidayType,
      shiftId: shift?._id,
    };
  });
}

function buildSchedule(
  employee: Doc<"employees">,
  shift: Doc<"shifts"> | null,
): LeaveWeekSchedule {
  const source = employee.schedule.defaultSchedule;
  const unpaidBreakMinutes = shift
    ? durationMinutes(shift.lunchStart, shift.lunchEnd)
    : undefined;
  const mapDay = (day: (typeof source)[keyof typeof source]) => ({
    in: shift && day.isWorkday ? shift.scheduleIn : day.in,
    out: shift && day.isWorkday ? shift.scheduleOut : day.out,
    isWorkday: day.isWorkday,
    unpaidBreakMinutes,
  });
  return {
    monday: mapDay(source.monday),
    tuesday: mapDay(source.tuesday),
    wednesday: mapDay(source.wednesday),
    thursday: mapDay(source.thursday),
    friday: mapDay(source.friday),
    saturday: mapDay(source.saturday),
    sunday: mapDay(source.sunday),
  };
}

function durationMinutes(start: string, end: string): number {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startValue = startHour * 60 + startMinute;
  const endValue = endHour * 60 + endMinute;
  return endValue >= startValue
    ? endValue - startValue
    : endValue + 24 * 60 - startValue;
}

async function loadApplicableHolidays(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  employee: Doc<"employees">,
  startLocalDate: string,
  endLocalDate: string,
): Promise<
  Array<{
    localDate: string;
    holidayId: Id<"holidays">;
    holidayType: Doc<"holidays">["type"];
  }>
> {
  const rows = await ctx.db
    .query("holidays")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(MAX_HOLIDAYS_PER_ORGANIZATION + 1);
  if (rows.length > MAX_HOLIDAYS_PER_ORGANIZATION) {
    throw new Error("Organization holiday calendar exceeds the supported limit");
  }
  const result = [];
  for (
    let timestamp = localDateToManilaTimestamp(startLocalDate);
    timestamp <= localDateToManilaTimestamp(endLocalDate);
    timestamp += DAY_MILLISECONDS
  ) {
    const holiday = rows.find(
      (candidate) =>
        candidate.type !== "special_working" &&
        holidayMatchesDate(candidate, timestamp) &&
        holidayAppliesToEmployee(candidate, employee),
    );
    if (holiday) {
      result.push({
        localDate: timestampToLocalDate(timestamp),
        holidayId: holiday._id,
        holidayType: holiday.type,
      });
    }
  }
  return result;
}

async function validateEligibility(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
  policy: Doc<"leavePolicies">,
  version: Doc<"leavePolicyVersions">,
  benefitEventId: Id<"leaveBenefitEvents"> | undefined,
  requestedStart: number,
  requestedEnd: number,
): Promise<Doc<"leaveBenefitEvents"> | null> {
  if (version.eligibilityBasis === "regularization_date") {
    const regularizationDate = employee.employment.regularizationDate;
    if (regularizationDate == null || regularizationDate > requestedStart) {
      throw new Error("Employee is not yet eligible for this leave policy");
    }
  }
  if (version.eligibilityBasis === "verified_qualification") {
    const qualificationType = qualificationTypeForPolicy(policy.sourceKey);
    const qualifications = await ctx.db
      .query("employeeLeaveQualifications")
      .withIndex("by_employee_type_valid_from", (query) =>
        query
          .eq("employeeId", employee._id)
          .eq("qualificationType", qualificationType)
          .lte("validFrom", requestedStart),
      )
      .order("desc")
      .take(MAX_QUALIFICATIONS + 1);
    if (qualifications.length > MAX_QUALIFICATIONS) {
      throw new Error("Employee leave qualification history exceeds the supported limit");
    }
    const qualification = qualifications.find(
      (candidate) =>
        candidate.organizationId === employee.organizationId &&
        candidate.verificationStatus === "verified" &&
        (candidate.validUntil === undefined || candidate.validUntil >= requestedEnd),
    );
    if (!qualification) {
      throw new Error("A verified leave qualification is required");
    }
  }

  if (!version.qualifyingEventRequired && version.eligibilityBasis !== "event") {
    if (benefitEventId !== undefined) {
      throw new Error("This leave policy does not use a qualifying event");
    }
    return null;
  }
  if (!benefitEventId) throw new Error("A verified qualifying event is required");
  const event = await ctx.db.get(benefitEventId);
  if (
    !event ||
    event.organizationId !== employee.organizationId ||
    event.employeeId !== employee._id ||
    event.verificationStatus !== "verified" ||
    !eventMatchesPolicy(policy.sourceKey, event.eventType)
  ) {
    throw new Error("A verified qualifying event is required");
  }
  if (
    version.eventUseWindowDays !== undefined &&
    (requestedStart < event.qualifyingDate ||
      requestedStart >
        event.qualifyingDate + version.eventUseWindowDays * DAY_MILLISECONDS)
  ) {
    throw new Error("Leave request is outside the qualifying event window");
  }
  return event;
}

function qualificationTypeForPolicy(sourceKey: string): string {
  if (sourceKey.includes("solo_parent")) return "solo_parent";
  return sourceKey.replace(/^(private|government)_/, "");
}

function eventMatchesPolicy(
  sourceKey: string,
  eventType: Doc<"leaveBenefitEvents">["eventType"],
): boolean {
  if (sourceKey.includes("maternity")) {
    return [
      "maternity",
      "miscarriage",
      "emergency_termination_of_pregnancy",
    ].includes(eventType);
  }
  if (sourceKey.includes("paternity")) return eventType === "spouse_delivery";
  if (sourceKey.includes("adoption")) return eventType === "adoption";
  if (sourceKey.includes("emergency")) return eventType === "calamity";
  if (sourceKey.includes("women")) return eventType === "surgery";
  if (sourceKey.includes("vawc")) return eventType === "other_protected";
  if (sourceKey.includes("rehabilitation")) {
    return eventType === "other_protected";
  }
  return eventType === "other_protected";
}

function assertCompletedService(
  employee: Doc<"employees">,
  version: Doc<"leavePolicyVersions">,
  requestedStart: number,
): void {
  const basis =
    version.eligibilityBasis === "regularization_date"
      ? employee.employment.regularizationDate
      : employee.employment.hireDate;
  if (basis == null) {
    throw new Error("Employee service date is required for leave eligibility");
  }
  const eligibleAt = addManilaMonths(basis, version.completedServiceMonths);
  if (eligibleAt > requestedStart) {
    throw new Error("Employee has not completed the required service period");
  }
}

function addManilaMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp + MANILA_OFFSET_MILLISECONDS);
  const originalDay = date.getUTCDate();
  const targetMonth = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return (
    Date.UTC(targetYear, normalizedMonth, Math.min(originalDay, lastDay)) -
    MANILA_OFFSET_MILLISECONDS
  );
}

function assertMinimumNotice(
  version: Doc<"leavePolicyVersions">,
  requestedStart: number,
  now: number,
): void {
  if (version.minimumNoticeDays === undefined) return;
  const noticeDays = Math.floor(
    (requestedStart - startOfManilaDay(now)) / DAY_MILLISECONDS,
  );
  if (noticeDays < version.minimumNoticeDays) {
    throw new Error("Leave request does not meet the minimum notice period");
  }
}

function startOfManilaDay(timestamp: number): number {
  return localDateToManilaTimestamp(timestampToLocalDate(timestamp));
}

async function assertEventLimits(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
  policy: Doc<"leavePolicies">,
  version: Doc<"leavePolicyVersions">,
  benefitEvent: Doc<"leaveBenefitEvents"> | null,
  units: number,
  requestedStart: number,
  excludeLeaveRequestId: Id<"leaveRequests"> | undefined,
): Promise<void> {
  if (
    version.maximumUnitsPerEvent === undefined &&
    version.maximumUnitsPerYear === undefined
  ) return;
  const requests = await ctx.db
    .query("leaveRequests")
    .withIndex("by_employee", (query) => query.eq("employeeId", employee._id))
    .take(MAX_EMPLOYEE_REQUESTS + 1);
  if (requests.length > MAX_EMPLOYEE_REQUESTS) {
    throw new Error("Employee leave request history exceeds the supported limit");
  }
  const year = new Date(requestedStart + MANILA_OFFSET_MILLISECONDS).getUTCFullYear();
  const activeRequests = requests.filter(
    (request) =>
      request._id !== excludeLeaveRequestId &&
      request.policyId === policy._id &&
      request.status !== "rejected" &&
      request.status !== "cancelled",
  );
  const eventUsed = activeRequests
    .filter(
      (request) =>
        benefitEvent !== null && request.benefitEventId === benefitEvent._id,
    )
    .reduce(
      (sum, request) => sum + (request.chargeableDuration ?? request.numberOfDays),
      0,
    );
  if (
    version.maximumUnitsPerEvent !== undefined &&
    eventUsed + units > version.maximumUnitsPerEvent
  ) {
    throw new Error("Leave request exceeds the qualifying-event limit");
  }
  if (version.maximumUnitsPerYear === undefined) return;
  const used = activeRequests
    .filter((request) => {
      const requestYear = new Date(
        (request.requestedStart ?? request.startDate) + MANILA_OFFSET_MILLISECONDS,
      ).getUTCFullYear();
      return (
        requestYear === year
      );
    })
    .reduce(
      (sum, request) => sum + (request.chargeableDuration ?? request.numberOfDays),
      0,
    );
  if (used + units > version.maximumUnitsPerYear) {
    throw new Error("Leave request exceeds the annual event limit");
  }
}

async function loadMatchingBalance(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
  policy: Doc<"leavePolicies">,
  version: Doc<"leavePolicyVersions">,
  requestedStart: number,
  requestedEnd: number,
): Promise<Doc<"employeeLeaveBalances"> | null> {
  if (version.accountBehavior === "non_credit") return null;
  const candidates =
    version.accountBehavior === "shared_pool"
      ? await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_pool_period", (query) =>
            query
              .eq("organizationId", employee.organizationId)
              .eq("employeeId", employee._id)
              .eq("poolKey", version.poolKey)
              .lte("periodStart", requestedStart),
          )
          .order("desc")
          .take(MAX_BALANCE_CANDIDATES + 1)
      : await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_policy_period", (query) =>
            query
              .eq("organizationId", employee.organizationId)
              .eq("employeeId", employee._id)
              .eq("policyId", policy._id)
              .lte("periodStart", requestedStart),
          )
          .order("desc")
          .take(MAX_BALANCE_CANDIDATES + 1);
  if (candidates.length > MAX_BALANCE_CANDIDATES) {
    throw new Error("Employee leave balance history exceeds the supported limit");
  }
  const balance = candidates.find(
    (candidate) =>
      candidate.periodStart !== undefined &&
      candidate.periodEnd !== undefined &&
      candidate.periodStart <= requestedStart &&
      candidate.periodEnd >= requestedEnd &&
      candidate.engineStatus !== "closed" &&
      candidate.engineStatus !== "reconciliation_required",
  );
  if (!balance) throw new Error("An open leave balance is required");
  return balance;
}

function assertDurationPrecision(
  precision: Doc<"organizationLeaveSettings">["requestPrecision"],
  args: Pick<LeaveRequestV2DraftArgs, "requestedDurationMode" | "requestedMinutes">,
): void {
  const effectivePrecision = precision ?? "day";
  if (effectivePrecision === "day" && args.requestedDurationMode !== "day") {
    throw new Error("Organization leave requests use whole-day precision");
  }
  if (
    effectivePrecision === "half_day" &&
    args.requestedDurationMode === "hour"
  ) {
    throw new Error("Organization leave requests do not support hourly precision");
  }
  if (
    args.requestedDurationMode !== "hour" &&
    args.requestedMinutes !== undefined
  ) {
    throw new Error("Requested minutes are allowed only for hourly leave");
  }
}

function roundDuration(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
