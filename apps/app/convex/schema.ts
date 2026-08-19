import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Organizations table
  organizations: defineTable({
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    taxId: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  organizationPayrollSettings: defineTable({
    organizationId: v.id("organizations"),
    salaryPaymentFrequency: v.union(
      v.literal("monthly"),
      v.literal("bimonthly"),
    ),
    firstPayDate: v.number(),
    secondPayDate: v.number(),
    cutoffDates: v.optional(
      v.object({
        firstCutoff: v.number(),
        secondCutoff: v.number(),
      }),
    ),
    payrollSettings: v.optional(
      v.object({
        nightDiffPercent: v.optional(v.number()),
        regularHolidayRate: v.optional(v.number()),
        specialHolidayRate: v.optional(v.number()),
        overtimeRegularRate: v.optional(v.number()),
        overtimeRestDayRate: v.optional(v.number()),
        regularHolidayOtRate: v.optional(v.number()),
        specialHolidayOtRate: v.optional(v.number()),
        nightDiffOnOtRate: v.optional(v.number()),
        nightDiffRegularHolidayRate: v.optional(v.number()),
        nightDiffSpecialHolidayRate: v.optional(v.number()),
        nightDiffRegularHolidayOtRate: v.optional(v.number()),
        nightDiffSpecialHolidayOtRate: v.optional(v.number()),
        dailyRateIncludesAllowance: v.optional(v.boolean()),
        dailyRateWorkingDaysPerYear: v.optional(v.number()),
        taxDeductionFrequency: v.optional(
          v.union(v.literal("once_per_month"), v.literal("twice_per_month")),
        ),
        taxDeductOnPay: v.optional(
          v.union(v.literal("first"), v.literal("second")),
        ),
        holidayNoWorkNoPay: v.optional(v.boolean()),
        absentBeforeHolidayNoHolidayPay: v.optional(v.boolean()),
        trainNinetyThousandCapOnAdditions: v.optional(v.boolean()),
      }),
    ),
    sourceSettingsId: v.optional(v.id("settings")),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  organizationAttendanceSettings: defineTable({
    organizationId: v.id("organizations"),
    attendanceSettings: v.object({
      defaultLunchBreakMinutes: v.optional(v.number()),
      defaultLunchStart: v.optional(v.string()),
      defaultLunchEnd: v.optional(v.string()),
      graceMinutes: v.optional(v.number()),
      roundingRule: v.optional(
        v.union(
          v.literal("none"),
          v.literal("nearest_5"),
          v.literal("nearest_15"),
          v.literal("floor_15"),
          v.literal("ceiling_15"),
        ),
      ),
      flexibleShiftsEnabled: v.optional(v.boolean()),
      overnightShiftCutoffHour: v.optional(v.number()),
      restDayPolicy: v.optional(
        v.union(
          v.literal("fixed_weekly"),
          v.literal("shift_based"),
          v.literal("attendance_based"),
        ),
      ),
      geofencePolicy: v.optional(
        v.object({
          enabled: v.boolean(),
          allowedRadiusMeters: v.optional(v.number()),
          requireForClockIn: v.optional(v.boolean()),
        }),
      ),
      importPolicy: v.optional(
        v.object({
          allowCsvImport: v.optional(v.boolean()),
          requireReviewBeforePosting: v.optional(v.boolean()),
        }),
      ),
      payrollLockPolicy: v.optional(
        v.object({
          lockAttendanceAfterPayrollFinalized: v.optional(v.boolean()),
          allowAdminCorrectionWithReason: v.optional(v.boolean()),
        }),
      ),
    }),
    sourceSettingsId: v.optional(v.id("settings")),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  organizationDepartments: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    normalizedName: v.string(),
    color: v.string(),
    departmentHeadUserId: v.optional(v.id("users")),
    costCenter: v.optional(v.string()),
    location: v.optional(v.string()),
    parentDepartmentNormalizedName: v.optional(v.string()),
    sourceSettingsId: v.optional(v.id("settings")),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_normalized_name", [
      "organizationId",
      "normalizedName",
    ]),

  organizationRequirementDefinitions: defineTable({
    organizationId: v.id("organizations"),
    type: v.string(),
    normalizedType: v.string(),
    isRequired: v.optional(v.boolean()),
    appliesToDepartments: v.optional(v.array(v.string())),
    appliesToEmploymentTypes: v.optional(v.array(v.string())),
    reminderDaysBeforeDue: v.optional(v.number()),
    requiresVerification: v.optional(v.boolean()),
    expiryDaysAfterSubmission: v.optional(v.number()),
    source: v.literal("organization"),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_normalized_type", [
      "organizationId",
      "normalizedType",
    ]),

  migrationRuns: defineTable({
    key: v.string(),
    version: v.number(),
    dryRun: v.boolean(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    phase: v.union(
      v.literal("organizations"),
      v.literal("identity_users"),
      v.literal("identity_credentials"),
      v.literal("identity_invitations"),
      v.literal("leave_organizations"),
      v.literal("leave_types"),
      v.literal("employee_children"),
      v.literal("leave_balances"),
      v.literal("workflow_settings"),
      v.literal("workflow_evaluations"),
      v.literal("workflow_applicants"),
      v.literal("communications_memos"),
      v.literal("communications_conversations"),
      v.literal("communications_messages"),
      v.literal("communications_preferences"),
      v.literal("communications_documents"),
      v.literal("communications_leave_attachments"),
      v.literal("assets_payroll_runs"),
      v.literal("assets_accounting_items"),
      v.literal("assets_assets"),
      v.literal("release3_organizations"),
      v.literal("release3_users"),
      v.literal("release3_invitations"),
      v.literal("release3_employees"),
      v.literal("release3_payroll_runs"),
      v.literal("release3_assets"),
      v.literal("release3_payslips"),
      v.literal("release3_evaluations"),
      v.literal("release3_settings"),
      v.literal("release3_applicants"),
      v.literal("release3_memos"),
      v.literal("release3_conversations"),
      v.literal("release3_messages"),
      v.literal("release3_chat_preferences"),
      v.literal("release3_leave_requests"),
      v.literal("release3_documents"),
      v.literal("release3_accounting_items"),
    ),
    cursor: v.optional(v.string()),
    batchSize: v.number(),
    counters: v.object({
      scanned: v.number(),
      changed: v.number(),
      unchanged: v.number(),
      skipped: v.number(),
      conflicts: v.number(),
      errors: v.number(),
    }),
    requiredDryRunId: v.optional(v.id("migrationRuns")),
    exportReference: v.optional(v.string()),
    exportAcknowledgedAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
  })
    .index("by_key_started", ["key", "startedAt"])
    .index("by_key_status", ["key", "status"]),

  migrationIssues: defineTable({
    runId: v.id("migrationRuns"),
    auditId: v.optional(v.id("migrationAudits")),
    organizationId: v.optional(v.id("organizations")),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    field: v.string(),
    code: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId", "createdAt"])
    .index("by_audit", ["auditId", "createdAt"]),

  migrationAudits: defineTable({
    migrationRunId: v.id("migrationRuns"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    phase: v.union(
      v.literal("organizations"),
      v.literal("payroll_settings"),
      v.literal("attendance_settings"),
      v.literal("departments"),
      v.literal("requirements"),
      v.literal("identity_users"),
      v.literal("identity_memberships"),
      v.literal("identity_credentials"),
      v.literal("identity_credential_targets"),
      v.literal("identity_invitations"),
      v.literal("leave_organizations"),
      v.literal("leave_types"),
      v.literal("employee_children"),
      v.literal("leave_balances"),
      v.literal("leave_source_verification"),
      v.literal("leave_target_settings"),
      v.literal("leave_target_types"),
      v.literal("leave_target_requirements"),
      v.literal("leave_target_deductions"),
      v.literal("leave_target_incentives"),
      v.literal("leave_target_overrides"),
      v.literal("leave_target_payments"),
      v.literal("leave_target_definitions"),
      v.literal("leave_target_values"),
      v.literal("leave_target_balances"),
      v.literal("workflow_settings"),
      v.literal("workflow_source_verification"),
      v.literal("workflow_target_ui_settings"),
      v.literal("workflow_target_settings_events"),
      v.literal("workflow_target_reviewers"),
      v.literal("workflow_target_evaluation_events"),
      v.literal("workflow_target_stage_events"),
      v.literal("workflow_target_notes"),
      v.literal("workflow_target_interviews"),
      v.literal("workflow_target_scorecards"),
      v.literal("workflow_target_offer_events"),
      v.literal("workflow_target_custom_definitions"),
      v.literal("workflow_target_custom_values"),
      v.literal("communications_memos"),
      v.literal("communications_source_verification"),
      v.literal("communications_target_memo_reactions"),
      v.literal("communications_target_memo_acknowledgements"),
      v.literal("communications_target_memo_audience"),
      v.literal("communications_target_conversation_members"),
      v.literal("communications_target_message_receipts"),
      v.literal("communications_target_pins"),
      v.literal("communications_target_document_grants"),
      v.literal("communications_target_storage_links"),
      v.literal("assets_payroll_runs"),
      v.literal("assets_accounting_items"),
      v.literal("assets_assets"),
      v.literal("assets_source_verification"),
      v.literal("assets_target_payroll_notes"),
      v.literal("assets_target_accounting_receipts"),
      v.literal("assets_target_custody_events"),
      v.literal("assets_target_maintenance_events"),
      v.literal("release3_contract"),
    ),
    cursor: v.optional(v.string()),
    verificationRunId: v.optional(v.id("migrationRuns")),
    batchSize: v.number(),
    organizations: v.number(),
    destination: v.object({
      expected: v.number(),
      matching: v.number(),
      missing: v.number(),
      duplicate: v.number(),
      mismatched: v.number(),
      unexpected: v.number(),
      totalRows: v.number(),
    }),
    duplicateLegacySettings: v.number(),
    sourceConflicts: v.number(),
    auditTruncated: v.boolean(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
  })
    .index("by_run", ["migrationRunId"])
    .index("by_status", ["status", "updatedAt"]),

  // Demo requests from marketing site
  demoRequests: defineTable({
    email: v.string(),
    companyName: v.optional(v.string()),
    name: v.optional(v.string()),
    message: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // Users table (extends Better Auth user)
  users: defineTable({
    email: v.string(),
    normalizedEmail: v.optional(v.string()),
    name: v.optional(v.string()),
    masterRole: v.optional(v.literal("super_admin")), // Master role: super_admin has access to /admin; null = regular user
    lastActiveOrganizationId: v.optional(v.id("organizations")), // Track user's last active organization
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_normalized_email", ["normalizedEmail"]),

  // User-Organization junction table (many-to-many relationship)
  userOrganizations: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    accessStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("suspended"),
        v.literal("alumni"),
        v.literal("disabled"),
        v.literal("removed"),
      ),
    ),
    accessUpdatedAt: v.optional(v.number()),
    accessUpdatedBy: v.optional(v.id("users")),
    employeeId: v.optional(v.id("employees")), // If user is also an employee in this org
    joinedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_organization", ["organizationId"])
    .index("by_user_organization", ["userId", "organizationId"])
    .index("by_organization_employee", ["organizationId", "employeeId"]),

  storageUploadIntents: defineTable({
    organizationId: v.id("organizations"),
    ownerUserId: v.id("users"),
    purpose: v.union(
      v.literal("accounting_receipt"),
      v.literal("announcement_attachment"),
      v.literal("applicant_resume"),
      v.literal("chat_attachment"),
      v.literal("document_attachment"),
      v.literal("employee_requirement"),
      v.literal("evaluation_attachment"),
      v.literal("leave_attachment"),
      v.literal("memo_attachment"),
      v.literal("payslip_pdf"),
    ),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerUserId", "createdAt"])
    .index("by_expiry", ["expiresAt"]),

  applicantUploadIntents: defineTable({
    organizationId: v.id("organizations"),
    jobId: v.id("jobs"),
    expiresAt: v.number(),
    storageId: v.optional(v.id("_storage")),
    registeredAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId", "createdAt"])
    .index("by_storage", ["storageId"])
    .index("by_expiry", ["expiresAt"]),

  storageObjects: defineTable({
    storageId: v.id("_storage"),
    organizationId: v.id("organizations"),
    ownerUserId: v.id("users"),
    purpose: v.union(
      v.literal("accounting_receipt"),
      v.literal("announcement_attachment"),
      v.literal("applicant_resume"),
      v.literal("chat_attachment"),
      v.literal("document_attachment"),
      v.literal("employee_requirement"),
      v.literal("evaluation_attachment"),
      v.literal("leave_attachment"),
      v.literal("memo_attachment"),
      v.literal("payslip_pdf"),
    ),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    state: v.union(
      v.literal("active"),
      v.literal("orphaned"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_organization", ["organizationId", "createdAt"])
    .index("by_owner", ["ownerUserId", "createdAt"]),

  storageObjectLinks: defineTable({
    organizationId: v.id("organizations"),
    storageId: v.id("_storage"),
    parentType: v.union(
      v.literal("memo"),
      v.literal("message"),
      v.literal("document"),
      v.literal("evaluation"),
      v.literal("leave_request"),
      v.literal("accounting_cost_item"),
    ),
    parentId: v.union(
      v.id("memos"),
      v.id("messages"),
      v.id("documents"),
      v.id("evaluations"),
      v.id("leaveRequests"),
      v.id("accountingCostItems"),
    ),
    purpose: v.union(
      v.literal("announcement_attachment"),
      v.literal("memo_attachment"),
      v.literal("chat_attachment"),
      v.literal("document_attachment"),
      v.literal("evaluation_attachment"),
      v.literal("leave_attachment"),
      v.literal("accounting_receipt"),
    ),
    sourceIndex: v.number(),
    contentType: v.optional(v.string()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_parent", ["parentType", "parentId"])
    .index("by_storage_parent", ["storageId", "parentType", "parentId"]),

  /** In-app notifications (not chat); excludes new-message events. */
  notifications: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    type: v.union(
      v.literal("leave_submitted"),
      v.literal("leave_approved"),
      v.literal("leave_rejected"),
      v.literal("payslip_ready"),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
    /** App path after org id, e.g. "leave?tab=requests" or "payslips?payslipId=…" */
    pathAfterOrg: v.string(),
    leaveRequestId: v.optional(v.id("leaveRequests")),
    payslipId: v.optional(v.id("payslips")),
    payrollRunId: v.optional(v.id("payrollRuns")),
  })
    .index("by_user_org_created", ["userId", "organizationId", "createdAt"])
    .index("by_user_org_unread", ["userId", "organizationId", "read"])
    /** Unread (read=false) with createdAt for cursor pagination, newest first */
    .index("by_user_org_read_created", [
      "userId",
      "organizationId",
      "read",
      "createdAt",
    ]),

  // Employees table (core module)
  employees: defineTable({
    organizationId: v.id("organizations"),
    personalInfo: v.object({
      firstName: v.string(),
      lastName: v.string(),
      middleName: v.optional(v.string()),
      email: v.string(),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      province: v.optional(v.string()), // For province-specific holiday pay (e.g. Cebu only)
      dateOfBirth: v.optional(v.number()),
      civilStatus: v.optional(v.string()),
      emergencyContact: v.optional(
        v.object({
          name: v.string(),
          relationship: v.string(),
          phone: v.string(),
        }),
      ),
    }),
    employment: v.object({
      employeeId: v.string(), // Company employee ID
      position: v.string(),
      department: v.string(),
      employmentType: v.union(
        v.literal("regular"),
        v.literal("probationary"),
        v.literal("contractual"),
        v.literal("part-time"),
      ),
      hireDate: v.number(),
      regularizationDate: v.optional(v.union(v.number(), v.null())),
      separationDate: v.optional(v.number()),
      lastWorkingDay: v.optional(v.number()),
      separationReason: v.optional(v.string()),
      finalPayStatus: v.optional(
        v.union(
          v.literal("not_started"),
          v.literal("pending"),
          v.literal("processing"),
          v.literal("paid"),
          v.literal("not_applicable"),
        ),
      ),
      clearanceStatus: v.optional(
        v.union(
          v.literal("not_started"),
          v.literal("pending"),
          v.literal("cleared"),
          v.literal("waived"),
        ),
      ),
      status: v.union(
        v.literal("active"),
        v.literal("resigned"),
        v.literal("terminated"),
      ),
    }),
    compensation: v.object({
      /** Encrypted at rest when ENCRYPTION_KEY is set (stored as pp:enc:v1:… string). */
      basicSalary: v.union(v.number(), v.string()),
      allowance: v.optional(v.union(v.number(), v.string())),
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly"),
      ),
      regularHolidayRate: v.optional(v.number()), // Actual rate for regular holidays (default 2.0 = 200% of daily)
      specialHolidayRate: v.optional(v.number()), // Actual rate for special holidays (default 1.3 = 130% of daily)
      nightDiffPercent: v.optional(v.number()), // Night differential override (default from settings)
      nightDiffOnOtRate: v.optional(v.number()),
      nightDiffRegularHolidayRate: v.optional(v.number()),
      nightDiffSpecialHolidayRate: v.optional(v.number()),
      nightDiffRegularHolidayOtRate: v.optional(v.number()),
      nightDiffSpecialHolidayOtRate: v.optional(v.number()),
      overtimeRegularRate: v.optional(v.number()), // Regular OT override (default from settings)
      overtimeRestDayRate: v.optional(v.number()), // Rest day OT override (default from settings)
      regularHolidayOtRate: v.optional(v.number()), // Regular holiday OT override (default from settings)
      specialHolidayOtRate: v.optional(v.number()), // Special holiday OT override (default from settings)
    }),
    schedule: v.object({
      defaultSchedule: v.object({
        monday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        tuesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        wednesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        thursday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        friday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        saturday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        sunday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
      }),
    }),
    /** Optional shift (Morning, UK, Night). When set, schedule + lunch come from shift; null/absent = use defaultSchedule + org default lunch. */
    shiftId: v.optional(v.union(v.id("shifts"), v.null())),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee_id", ["employment.employeeId"])
    .index("by_shift", ["shiftId"])
    .index("by_status", ["employment.status"])
    .index("by_department", ["employment.department"]),

  employeeLifecycleEvents: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    type: v.union(
      v.literal("hired"),
      v.literal("resigned"),
      v.literal("terminated"),
      v.literal("rehired"),
    ),
    effectiveAt: v.number(),
    position: v.string(),
    department: v.string(),
    employmentType: v.union(
      v.literal("regular"),
      v.literal("probationary"),
      v.literal("contractual"),
      v.literal("part-time"),
    ),
    reason: v.optional(v.string()),
    recordedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_employee_effective_at", ["employeeId", "effectiveAt"])
    .index("by_organization_effective_at", ["organizationId", "effectiveAt"]),

  organizationLeaveSettings: defineTable({
    organizationId: v.id("organizations"),
    employmentSector: v.optional(
      v.union(v.literal("private"), v.literal("government")),
    ),
    policyYearBasis: v.optional(v.literal("calendar_year")),
    requestPrecision: v.optional(
      v.union(v.literal("day"), v.literal("half_day"), v.literal("hour")),
    ),
    approvalSignatureMode: v.optional(
      v.union(
        v.literal("none"),
        v.literal("stored_signature"),
        v.literal("per_decision"),
      ),
    ),
    migrationState: v.optional(
      v.union(
        v.literal("awaiting_sector_confirmation"),
        v.literal("pending"),
        v.literal("ready"),
        v.literal("active"),
      ),
    ),
    activePolicyEngineVersion: v.optional(v.number()),
    policyEngineCutoverAt: v.optional(v.number()),
    proratedLeave: v.optional(v.boolean()),
    leaveAccrualFrequency: v.optional(
      v.union(
        v.literal("monthly"),
        v.literal("semi_annual"),
        v.literal("annual"),
      ),
    ),
    leaveTrackerMode: v.optional(
      v.union(v.literal("general"), v.literal("by_type")),
    ),
    enableAnniversaryLeave: v.optional(v.boolean()),
    anniversaryLeaveMaxDays: v.optional(v.number()),
    maxConvertibleLeaveDays: v.optional(v.number()),
    annualSil: v.optional(v.number()),
    grantLeaveUponRegularization: v.optional(v.boolean()),
    paidLeaveRequiresRegularization: v.optional(v.boolean()),
    leaveGuidelines: v.optional(v.string()),
    leaveRequestFormTemplate: v.optional(v.string()),
    leaveRequestPdfLayout: v.optional(
      v.object({
        header: v.optional(
          v.object({
            enabled: v.boolean(),
            kind: v.union(
              v.literal("none"),
              v.literal("text"),
              v.literal("image"),
            ),
            text: v.optional(v.string()),
            imageDataUrl: v.optional(v.string()),
            align: v.union(
              v.literal("left"),
              v.literal("center"),
              v.literal("right"),
              v.literal("justify"),
            ),
          }),
        ),
        footer: v.optional(
          v.object({
            enabled: v.boolean(),
            kind: v.union(
              v.literal("none"),
              v.literal("text"),
              v.literal("image"),
            ),
            text: v.optional(v.string()),
            imageDataUrl: v.optional(v.string()),
            align: v.union(
              v.literal("left"),
              v.literal("center"),
              v.literal("right"),
              v.literal("justify"),
            ),
          }),
        ),
      }),
    ),
    sourceSettingsId: v.optional(v.id("settings")),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  employeeLeaveBalances: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    policyId: v.optional(v.id("leavePolicies")),
    policyVersionId: v.optional(v.id("leavePolicyVersions")),
    poolKey: v.optional(v.string()),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    granted: v.optional(v.number()),
    reserved: v.optional(v.number()),
    converted: v.optional(v.number()),
    expired: v.optional(v.number()),
    projectionVersion: v.optional(v.number()),
    lastLedgerEntryId: v.optional(v.id("leaveLedgerEntries")),
    engineStatus: v.optional(
      v.union(
        v.literal("open"),
        v.literal("closed"),
        v.literal("reconciliation_required"),
      ),
    ),
    year: v.number(),
    leaveTypeKey: v.string(),
    total: v.number(),
    used: v.number(),
    balance: v.number(),
    source: v.union(
      v.literal("employee_credits"),
      v.literal("legacy_tracker"),
      v.literal("yearly_tracker"),
    ),
    annualSilOverride: v.optional(v.number()),
    overrideReason: v.optional(v.string()),
    updatedBy: v.optional(v.id("users")),
    approvedDays: v.number(),
    reconciliationStatus: v.union(
      v.literal("matching"),
      v.literal("mismatched"),
      v.literal("not_applicable"),
    ),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_year_type", ["employeeId", "year", "leaveTypeKey"])
    .index("by_organization", ["organizationId"])
    .index("by_organization_year", ["organizationId", "year"])
    .index("by_organization_employee_policy_period", [
      "organizationId",
      "employeeId",
      "policyId",
      "periodStart",
      "periodEnd",
    ])
    .index("by_organization_employee_pool_period", [
      "organizationId",
      "employeeId",
      "poolKey",
      "periodStart",
      "periodEnd",
    ]),

  employeeRequirements: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    requirementDefinitionId: v.optional(
      v.id("organizationRequirementDefinitions"),
    ),
    sourceKey: v.string(),
    type: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("submitted"),
      v.literal("verified"),
    ),
    file: v.optional(v.id("_storage")),
    submittedDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    isRequired: v.optional(v.boolean()),
    appliesToDepartments: v.optional(v.array(v.string())),
    appliesToEmploymentTypes: v.optional(v.array(v.string())),
    reminderDaysBeforeDue: v.optional(v.number()),
    requiresVerification: v.optional(v.boolean()),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.id("users")),
    verificationNotes: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
    reminderSentAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    isDefault: v.optional(v.boolean()),
    isCustom: v.optional(v.boolean()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_source_key", ["employeeId", "sourceKey"])
    .index("by_organization", ["organizationId"])
    .index("by_definition", ["requirementDefinitionId"]),

  employeeRequirementEvents: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    requirementId: v.id("employeeRequirements"),
    type: v.union(
      v.literal("submitted"),
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("archived"),
    ),
    file: v.optional(v.id("_storage")),
    occurredAt: v.number(),
    actorUserId: v.id("users"),
    notes: v.optional(v.string()),
    expiryDate: v.optional(v.number()),
    migrationVersion: v.number(),
    createdAt: v.number(),
  })
    .index("by_requirement_occurred_at", ["requirementId", "occurredAt"])
    .index("by_employee", ["employeeId", "occurredAt"])
    .index("by_organization", ["organizationId", "occurredAt"]),

  employeeDeductions: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    sourceId: v.string(),
    type: v.union(
      v.literal("government"),
      v.literal("loan"),
      v.literal("other"),
    ),
    name: v.string(),
    amount: v.number(),
    frequency: v.union(v.literal("monthly"), v.literal("per-cutoff")),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    isActive: v.boolean(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_source_id", ["employeeId", "sourceId"])
    .index("by_organization", ["organizationId"]),

  employeeIncentives: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    sourceId: v.string(),
    name: v.string(),
    amount: v.number(),
    frequency: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("one-time"),
      v.literal("per-cutoff"),
    ),
    isActive: v.boolean(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_source_id", ["employeeId", "sourceId"])
    .index("by_organization", ["organizationId"]),

  employeeScheduleOverrides: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.number(),
    in: v.string(),
    out: v.string(),
    reason: v.string(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_date", ["employeeId", "date"])
    .index("by_organization", ["organizationId"]),

  employeePaymentAccounts: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    bankName: v.string(),
    accountNumber: v.string(),
    accountName: v.string(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_organization", ["organizationId"]),

  organizationCustomFieldDefinitions: defineTable({
    organizationId: v.id("organizations"),
    entityType: v.union(v.literal("employee"), v.literal("applicant")),
    sourceKey: v.string(),
    label: v.string(),
    valueType: v.union(
      v.literal("mixed"),
      v.literal("string"),
      v.literal("number"),
      v.literal("boolean"),
      v.literal("null"),
      v.literal("array"),
      v.literal("object"),
    ),
    isActive: v.boolean(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_entity_key", [
      "organizationId",
      "entityType",
      "sourceKey",
    ])
    .index("by_organization", ["organizationId"]),

  employeeCustomFieldValues: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    definitionId: v.id("organizationCustomFieldDefinitions"),
    sourceKey: v.string(),
    valueType: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("boolean"),
      v.literal("null"),
      v.literal("array"),
      v.literal("object"),
    ),
    valueJson: v.string(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_source_key", ["employeeId", "sourceKey"])
    .index("by_definition", ["definitionId"])
    .index("by_organization", ["organizationId"]),

  organizationUiSettings: defineTable({
    organizationId: v.id("organizations"),
    evaluationColumns: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          type: v.union(
            v.literal("date"),
            v.literal("number"),
            v.literal("text"),
            v.literal("rating"),
          ),
          hidden: v.optional(v.boolean()),
          hasRatingColumn: v.optional(v.boolean()),
          hasNotesColumn: v.optional(v.boolean()),
        }),
      ),
    ),
    recruitmentTableColumns: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          field: v.string(),
          type: v.union(
            v.literal("text"),
            v.literal("number"),
            v.literal("date"),
            v.literal("badge"),
            v.literal("link"),
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
        }),
      ),
    ),
    requirementsTableColumns: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          field: v.string(),
          type: v.union(
            v.literal("text"),
            v.literal("number"),
            v.literal("date"),
            v.literal("badge"),
            v.literal("link"),
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
        }),
      ),
    ),
    leaveTableColumns: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          field: v.string(),
          type: v.union(
            v.literal("text"),
            v.literal("number"),
            v.literal("date"),
            v.literal("badge"),
            v.literal("link"),
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
          isDefault: v.optional(v.boolean()),
          hidden: v.optional(v.boolean()),
        }),
      ),
    ),
    sourceSettingsId: v.id("settings"),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  organizationSettingsEvents: defineTable({
    organizationId: v.id("organizations"),
    sourceSettingsId: v.id("settings"),
    sourceIndex: v.number(),
    area: v.string(),
    version: v.number(),
    changedBy: v.id("users"),
    changedAt: v.number(),
    reason: v.optional(v.string()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_settings_source_index", ["sourceSettingsId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  evaluationReviewers: defineTable({
    organizationId: v.id("organizations"),
    evaluationId: v.id("evaluations"),
    reviewerId: v.id("users"),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_evaluation_reviewer", ["evaluationId", "reviewerId"])
    .index("by_organization", ["organizationId"]),

  evaluationEvents: defineTable({
    organizationId: v.id("organizations"),
    evaluationId: v.id("evaluations"),
    sourceIndex: v.number(),
    action: v.string(),
    at: v.number(),
    by: v.id("users"),
    summary: v.optional(v.string()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_evaluation_source_index", ["evaluationId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  applicantStageEvents: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    sourceIndex: v.number(),
    from: v.optional(v.string()),
    to: v.string(),
    changedAt: v.number(),
    changedBy: v.optional(v.id("users")),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant_source_index", ["applicantId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  applicantNotes: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    sourceIndex: v.number(),
    date: v.number(),
    author: v.id("users"),
    content: v.string(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant_source_index", ["applicantId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  applicantInterviews: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    sourceIndex: v.number(),
    date: v.number(),
    type: v.string(),
    interviewer: v.id("users"),
    interviewers: v.optional(v.array(v.id("users"))),
    remarks: v.optional(v.string()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant_source_index", ["applicantId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  applicantScorecards: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    sourceIndex: v.number(),
    reviewer: v.id("users"),
    criteria: v.array(
      v.object({
        label: v.string(),
        score: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
    overallScore: v.number(),
    recommendation: v.optional(v.string()),
    submittedAt: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant_source_index", ["applicantId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  applicantOfferEvents: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    cycle: v.optional(v.number()),
    eventIndex: v.optional(v.number()),
    status: v.union(
      v.literal("not_requested"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    requestedBy: v.optional(v.id("users")),
    requestedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant", ["applicantId"])
    .index("by_applicant_cycle_event", ["applicantId", "cycle", "eventIndex"])
    .index("by_organization", ["organizationId"]),

  applicantCustomFieldValues: defineTable({
    organizationId: v.id("organizations"),
    applicantId: v.id("applicants"),
    definitionId: v.id("organizationCustomFieldDefinitions"),
    sourceKey: v.string(),
    valueType: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("boolean"),
      v.literal("null"),
      v.literal("array"),
      v.literal("object"),
    ),
    valueJson: v.string(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_applicant_source_key", ["applicantId", "sourceKey"])
    .index("by_definition", ["definitionId"])
    .index("by_organization", ["organizationId"]),

  /** Short-lived tokens for "Forgot PIN" payslip access. */
  payslipPinResets: defineTable({
    employeeId: v.id("employees"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_token_hash", ["tokenHash"]),

  payslipPinAttempts: defineTable({
    userId: v.id("users"),
    employeeId: v.id("employees"),
    organizationId: v.id("organizations"),
    attemptCount: v.number(),
    windowStartedAt: v.number(),
    lockedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user_employee", ["userId", "employeeId"])
    .index("by_locked_until", ["lockedUntil"]),

  payslipCredentials: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    credentialHash: v.string(),
    credentialVersion: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_organization", ["organizationId"]),

  // Employee schedule history (effective-dated snapshots).
  // Used so attendance/payroll resolve the schedule that was active on a specific date.
  employeeScheduleHistory: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    effectiveFrom: v.number(), // Manila day start UTC ms
    schedule: v.object({
      defaultSchedule: v.object({
        monday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        tuesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        wednesday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        thursday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        friday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        saturday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
        sunday: v.object({
          in: v.string(),
          out: v.string(),
          isWorkday: v.boolean(),
        }),
      }),
      scheduleOverrides: v.optional(
        v.array(
          v.object({
            date: v.number(),
            in: v.string(),
            out: v.string(),
            reason: v.string(),
          }),
        ),
      ),
    }),
    shiftId: v.optional(v.union(v.id("shifts"), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"])
    .index("by_employee_effective_from", ["employeeId", "effectiveFrom"]),

  // Attendance table
  attendance: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.number(), // Unix timestamp
    scheduleIn: v.string(), // Time string "HH:mm"
    scheduleOut: v.string(),
    /** Lunch window used for this record (from shift or org default). Enables correct late/undertime when clock in after lunch. */
    lunchStart: v.optional(v.string()),
    lunchEnd: v.optional(v.string()),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()), // Hours
    late: v.optional(v.number()), // Minutes late (use when lateManualOverride is true)
    undertime: v.optional(v.number()), // Hours undertime (use when undertimeManualOverride is true)
    lateManualOverride: v.optional(v.boolean()), // true = use stored late (e.g. 0) instead of calculating
    undertimeManualOverride: v.optional(v.boolean()), // true = use stored undertime (e.g. 0) instead of calculating
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working"),
      ),
    ),
    remarks: v.optional(v.string()),
    importKey: v.optional(v.string()),
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half-day"),
      v.literal("leave"), // Legacy: treat as leave_with_pay for backward compatibility
      v.literal("leave_with_pay"),
      v.literal("leave_without_pay"), // Treated as absent in payroll (deduction)
      v.literal("no_work"), // Holiday when employee did not work — no additional pay
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_date", ["date"])
    .index("by_organization", ["organizationId"])
    .index("by_employee_date", ["employeeId", "date"])
    .index("by_organization_date", ["organizationId", "date"])
    .index("by_organization_import_key", ["organizationId", "importKey"]),

  attendanceAuditLogs: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    attendanceId: v.id("attendance"),
    payrollRunId: v.optional(v.id("payrollRuns")),
    actorUserId: v.id("users"),
    actorRole: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("self_punch_in"),
      v.literal("self_punch_out"),
      v.literal("bulk_create"),
      v.literal("bulk_update"),
      v.literal("recalculate"),
      v.literal("duplicate_cleanup"),
      v.literal("holiday_sync"),
      v.literal("payroll_sync"),
    ),
    correctionReason: v.optional(v.string()),
    beforeJson: v.optional(v.string()),
    afterJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_employee_created", ["employeeId", "createdAt"])
    .index("by_attendance_created", ["attendanceId", "createdAt"]),

  // Shifts table (per-org; each shift has schedule + lunch window for late/undertime)
  shifts: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // e.g. "Morning", "UK", "Night"
    scheduleIn: v.string(), // HH:mm
    scheduleOut: v.string(),
    lunchStart: v.string(), // HH:mm
    lunchEnd: v.string(), // HH:mm
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // Holidays table
  holidays: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    date: v.number(), // Unix timestamp
    offsetDate: v.optional(v.number()), // Optional offset date; payroll uses this as the holiday date when set
    type: v.union(
      v.literal("regular"),
      v.literal("special"), // Special non-working holiday (has premium rate)
      v.literal("special_working"), // Special working holiday (no additional rate)
    ),
    isRecurring: v.boolean(),
    year: v.optional(v.number()), // For non-recurring holidays
    /** When true (default for backward compat), holiday applies to all employees. When false, only employees in provinces list get holiday pay. */
    applyToAll: v.optional(v.boolean()),
    /** When applyToAll is false, only employees with province in this list receive holiday pay. */
    provinces: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_date", ["date"])
    .index("by_year", ["year"]),

  // Payroll runs table
  payrollRuns: defineTable({
    organizationId: v.id("organizations"),
    cutoffStart: v.number(),
    cutoffEnd: v.number(),
    period: v.string(), // "2025-01-01 to 2025-01-15" or "13th Month Pay 2025"
    /** "regular" = standard payroll; "13th_month" = 13th month pay run; "leave_conversion" = leave to cash; "final_pay" = offboarding payroll */
    runType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("13th_month"),
        v.literal("leave_conversion"),
        v.literal("final_pay"),
      ),
    ),
    /** For 13th month runs: the calendar year (e.g. 2025) */
    year: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("finalized"),
      v.literal("paid"),
      v.literal("archived"),
      v.literal("cancelled"),
    ),
    processedBy: v.id("users"),
    processedAt: v.optional(v.number()),
    /** Set when run is saved as draft; indicates gov/attendance deductions were applied in payslips */
    deductionsEnabled: v.optional(v.boolean()),
    draftConfig: v.optional(
      v.union(
        v.string(),
        v.object({
          employeeIds: v.array(v.id("employees")),
          manualDeductions: v.optional(
            v.array(
              v.object({
                employeeId: v.id("employees"),
                deductions: v.array(
                  v.object({
                    name: v.string(),
                    amount: v.number(),
                    type: v.string(),
                  }),
                ),
              }),
            ),
          ),
          incentives: v.optional(
            v.array(
              v.object({
                employeeId: v.id("employees"),
                incentives: v.array(
                  v.object({
                    name: v.string(),
                    amount: v.number(),
                    type: v.string(),
                    /** When false, amount is not included in taxable gross (withholding base). */
                    taxable: v.optional(v.boolean()),
                  }),
                ),
              }),
            ),
          ),
          governmentDeductionSettings: v.optional(
            v.array(
              v.object({
                employeeId: v.id("employees"),
                sss: v.object({
                  enabled: v.boolean(),
                  frequency: v.union(v.literal("full"), v.literal("half")),
                }),
                pagibig: v.object({
                  enabled: v.boolean(),
                  frequency: v.union(v.literal("full"), v.literal("half")),
                }),
                philhealth: v.object({
                  enabled: v.boolean(),
                  frequency: v.union(v.literal("full"), v.literal("half")),
                }),
                tax: v.object({
                  enabled: v.boolean(),
                  frequency: v.union(v.literal("full"), v.literal("half")),
                }),
              }),
            ),
          ),
          nonTaxableAllowanceOverrides: v.optional(
            v.array(
              v.object({
                employeeId: v.id("employees"),
                amount: v.number(),
              }),
            ),
          ),
          payslipOverrides: v.optional(
            v.array(
              v.object({
                employeeId: v.id("employees"),
                deductions: v.optional(
                  v.array(
                    v.object({
                      name: v.string(),
                      amount: v.number(),
                      type: v.string(),
                    }),
                  ),
                ),
                incentives: v.optional(
                  v.array(
                    v.object({
                      name: v.string(),
                      amount: v.number(),
                      type: v.string(),
                      taxable: v.optional(v.boolean()),
                    }),
                  ),
                ),
                nonTaxableAllowance: v.optional(v.number()),
                variableEarnings: v.optional(
                  v.object({
                    holidayPay: v.number(),
                    nightDiffPay: v.number(),
                    restDayPay: v.number(),
                    overtimeRegular: v.number(),
                    overtimeRestDay: v.number(),
                    overtimeRestDayExcess: v.number(),
                    overtimeSpecialHoliday: v.number(),
                    overtimeSpecialHolidayExcess: v.number(),
                    overtimeLegalHoliday: v.number(),
                    overtimeLegalHolidayExcess: v.number(),
                  }),
                ),
              }),
            ),
          ),
          overrideReview: v.optional(
            v.object({
              status: v.union(v.literal("needs_review"), v.literal("reviewed")),
              generatedAt: v.number(),
              reviewedAt: v.optional(v.number()),
              reviewedBy: v.optional(v.id("users")),
              employees: v.array(
                v.object({
                  employeeId: v.id("employees"),
                  fields: v.array(v.string()),
                  deductionOverrideCount: v.optional(v.number()),
                  incentiveOverrideCount: v.optional(v.number()),
                }),
              ),
            }),
          ),
        }),
      ),
    ),
    /** Dependency snapshot captured when draft payslips were last regenerated. */
    draftDependencySnapshot: v.optional(
      v.object({
        attendance: v.number(),
        holidays: v.number(),
        payrollSettings: v.number(),
        leaveTypes: v.number(),
        shifts: v.number(),
        employees: v.number(),
        /** Max updatedAt of approved leave overlapping the cutoff (per draft employees). */
        leaveRequests: v.optional(v.number()),
        /** Org row updatedAt (pay cadence, etc.). */
        organization: v.optional(v.number()),
        /** Row counts so deletes are detected (max timestamp alone can go down). */
        attendanceRowCount: v.optional(v.number()),
        leaveRequestRowCount: v.optional(v.number()),
        holidayRowCount: v.optional(v.number()),
        shiftRowCount: v.optional(v.number()),
        leaveTypeRowCount: v.optional(v.number()),
      }),
    ),
    /**
     * JSON: `{ v, dates, summary, capturedAt }` — frozen payroll run summary
     * (attendance grid + roll-ups) from last save or finalize. Rebuilt when
     * payslips/snapshot inputs change.
     */
    summarySnapshot: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_period", ["cutoffStart", "cutoffEnd"])
    .index("by_organization_cutoff_start", ["organizationId", "cutoffStart"])
    .index("by_organization_status_run_type_cutoff_end", [
      "organizationId",
      "status",
      "runType",
      "cutoffEnd",
    ])
    .index("by_organization_runType_year", [
      "organizationId",
      "runType",
      "year",
    ]),

  payrollRunNotes: defineTable({
    organizationId: v.id("organizations"),
    payrollRunId: v.id("payrollRuns"),
    employeeId: v.id("employees"),
    noteDate: v.number(),
    note: v.string(),
    addedBy: v.id("users"),
    addedAt: v.number(),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_payroll_run", ["payrollRunId"])
    .index("by_payroll_run_source", ["payrollRunId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  finalSettlements: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    separationEventId: v.optional(v.id("employeeLifecycleEvents")),
    separationKey: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("in_review"),
      v.literal("ready_for_payroll"),
      v.literal("payroll_generated"),
      v.literal("released"),
      v.literal("void"),
    ),
    separationType: v.optional(
      v.union(v.literal("resigned"), v.literal("terminated")),
    ),
    separationDate: v.optional(v.number()),
    lastWorkingDay: v.optional(v.number()),
    separationReason: v.optional(v.string()),
    clearanceItems: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        ownerRole: v.optional(v.string()),
        required: v.boolean(),
        status: v.union(
          v.literal("pending"),
          v.literal("completed"),
          v.literal("waived"),
        ),
        completedBy: v.optional(v.id("users")),
        completedAt: v.optional(v.number()),
        waivedBy: v.optional(v.id("users")),
        waivedAt: v.optional(v.number()),
        notes: v.optional(v.string()),
      }),
    ),
    loanPayoffs: v.array(
      v.object({
        id: v.string(),
        deductionId: v.optional(v.string()),
        name: v.string(),
        scheduledAmount: v.optional(v.number()),
        payoffAmount: v.number(),
        rule: v.union(
          v.literal("deduct_full_balance"),
          v.literal("deduct_scheduled_amount"),
          v.literal("waive"),
          v.literal("custom_amount"),
        ),
        status: v.union(
          v.literal("pending"),
          v.literal("approved"),
          v.literal("waived"),
        ),
        notes: v.optional(v.string()),
      }),
    ),
    customDeductions: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        amount: v.number(),
        type: v.union(
          v.literal("loan"),
          v.literal("company_property"),
          v.literal("cash_advance"),
          v.literal("training_bond"),
          v.literal("other"),
        ),
        taxable: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      }),
    ),
    payrollRunId: v.optional(v.id("payrollRuns")),
    payslipId: v.optional(v.id("payslips")),
    bir2316: v.object({
      status: v.union(
        v.literal("not_started"),
        v.literal("data_ready"),
        v.literal("document_generated"),
        v.literal("released"),
      ),
      documentId: v.optional(v.id("documents")),
      generatedAt: v.optional(v.number()),
      releasedAt: v.optional(v.number()),
      releasedBy: v.optional(v.id("users")),
      calculationVersion: v.optional(v.number()),
      notes: v.optional(v.string()),
    }),
    finalTaxRelease: v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("reviewed"),
        v.literal("released"),
      ),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      releasedBy: v.optional(v.id("users")),
      releasedAt: v.optional(v.number()),
      calculationVersion: v.optional(v.number()),
      annualTaxableIncome: v.optional(v.number()),
      annualTaxDue: v.optional(v.number()),
      taxAlreadyWithheld: v.optional(v.number()),
      calculatedAdjustment: v.optional(v.number()),
      appliedAdjustment: v.optional(v.number()),
      variance: v.optional(v.number()),
      overrideReason: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
    calculationVersion: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_employee", ["employeeId"])
    .index("by_employee_separation_key", ["employeeId", "separationKey"])
    .index("by_payroll_run", ["payrollRunId"]),

  // Payslips table
  payslips: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    employeeSnapshot: v.optional(
      v.union(
        v.string(),
        v.object({
          personalInfo: v.object({
            firstName: v.optional(v.string()),
            lastName: v.optional(v.string()),
            email: v.optional(v.string()),
          }),
          employment: v.object({
            employeeId: v.optional(v.string()),
            hireDate: v.optional(v.number()),
            position: v.optional(v.string()),
          }),
          compensation: v.object({
            salaryType: v.optional(v.string()),
            basicSalary: v.optional(v.number()),
            allowance: v.optional(v.number()),
          }),
          payslipPdfPassword: v.optional(v.string()),
        }),
      ),
    ),
    payrollRunId: v.id("payrollRuns"),
    period: v.string(),
    /**
     * Cutoff range for this payslip in epoch ms. Kept alongside the display-only `period`
     * string so we can range-query by month without locale-dependent date parsing.
     * Optional for backwards compatibility with rows created before this field existed.
     */
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    /** Numeric fields may be AES-GCM ciphertext strings when ENCRYPTION_KEY is set. */
    grossPay: v.union(v.number(), v.string()),
    /** Basic pay (regular compensation) for this period - used for 13th month computation */
    basicPay: v.optional(v.union(v.number(), v.string())),
    deductions: v.union(
      v.string(),
      v.array(
        v.object({
          name: v.string(),
          amount: v.union(v.number(), v.string()),
          type: v.string(),
        }),
      ),
    ),
    incentives: v.optional(
      v.union(
        v.string(),
        v.array(
          v.object({
            name: v.string(),
            amount: v.union(v.number(), v.string()),
            type: v.string(),
            /** When false, amount is paid out but excluded from taxable gross. */
            taxable: v.optional(v.boolean()),
          }),
        ),
      ),
    ),
    nonTaxableAllowance: v.optional(v.union(v.number(), v.string())),
    netPay: v.union(v.number(), v.string()),
    daysWorked: v.union(v.number(), v.string()),
    absences: v.union(v.number(), v.string()),
    statutoryBenefitSupportedLeaveDays: v.optional(
      v.union(v.number(), v.string()),
    ),
    statutoryBenefitSupportedLeavePay: v.optional(
      v.union(v.number(), v.string()),
    ),
    lateHours: v.union(v.number(), v.string()),
    undertimeHours: v.union(v.number(), v.string()),
    overtimeHours: v.union(v.number(), v.string()),
    holidayPay: v.optional(v.union(v.number(), v.string())),
    regularHolidayPay: v.optional(v.union(v.number(), v.string())),
    specialHolidayPay: v.optional(v.union(v.number(), v.string())),
    /** When holidayPay > 0: "regular" = Legal Holiday, "special" = Special Holiday (for label only). */
    holidayPayType: v.optional(
      v.union(v.literal("regular"), v.literal("special")),
    ),
    restDayPay: v.optional(v.union(v.number(), v.string())),
    nightDiffPay: v.optional(v.union(v.number(), v.string())),
    /** Per-day night diff (debug); encrypted JSON string when ENCRYPTION_KEY is set. */
    nightDiffBreakdown: v.optional(
      v.union(
        v.string(),
        v.array(
          v.object({
            label: v.string(),
            date: v.number(),
            amount: v.number(),
            category: v.optional(
              v.union(
                v.literal("regular"),
                v.literal("regular_ot"),
                v.literal("rest_day"),
                v.literal("rest_day_ot"),
                v.literal("regular_holiday"),
                v.literal("regular_holiday_ot"),
                v.literal("special_holiday"),
                v.literal("special_holiday_ot"),
              ),
            ),
          }),
        ),
      ),
    ),
    overtimeRegular: v.optional(v.union(v.number(), v.string())),
    overtimeRestDay: v.optional(v.union(v.number(), v.string())),
    overtimeRestDayExcess: v.optional(v.union(v.number(), v.string())),
    overtimeSpecialHoliday: v.optional(v.union(v.number(), v.string())),
    overtimeSpecialHolidayExcess: v.optional(v.union(v.number(), v.string())),
    overtimeLegalHoliday: v.optional(v.union(v.number(), v.string())),
    overtimeLegalHolidayExcess: v.optional(v.union(v.number(), v.string())),
    pendingDeductions: v.optional(v.union(v.number(), v.string())),
    noWorkNoPayDays: v.optional(v.union(v.number(), v.string())),
    hasWorkedAtLeastOneDay: v.optional(v.boolean()),
    /** Employer share of gov contributions (per cutoff) for accounting total. */
    employerContributions: v.optional(
      v.union(
        v.string(),
        v.object({
          sss: v.optional(v.union(v.number(), v.string())),
          philhealth: v.optional(v.union(v.number(), v.string())),
          pagibig: v.optional(v.union(v.number(), v.string())),
        }),
      ),
    ),
    pdfFile: v.optional(v.id("_storage")),
    concernSummary: v.optional(
      v.object({
        messageCount: v.number(),
        lastMessageAt: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_periodStart", ["employeeId", "periodStart"])
    .index("by_payroll_run", ["payrollRunId"])
    .index("by_payroll_run_employee", ["payrollRunId", "employeeId"])
    .index("by_organization", ["organizationId"])
    .index("by_period", ["period"]),

  /**
   * Append-only log when a payslip on a finalized/paid run is edited.
   * Rows with notified=false are pending until the updated PDF is sent in chat.
   */
  payslipCorrections: defineTable({
    organizationId: v.id("organizations"),
    payrollRunId: v.id("payrollRuns"),
    payslipId: v.id("payslips"),
    reason: v.string(),
    oldGrossPay: v.optional(v.number()),
    newGrossPay: v.optional(v.number()),
    oldNetPay: v.optional(v.number()),
    newNetPay: v.optional(v.number()),
    deltaNetPay: v.optional(v.number()),
    oldTotalDeductions: v.optional(v.number()),
    newTotalDeductions: v.optional(v.number()),
    oldTotalAdditions: v.optional(v.number()),
    newTotalAdditions: v.optional(v.number()),
    oldNonTaxableAllowance: v.optional(v.number()),
    newNonTaxableAllowance: v.optional(v.number()),
    changeSummary: v.optional(v.array(v.string())),
    createdBy: v.id("users"),
    createdAt: v.number(),
    notified: v.boolean(),
  })
    .index("by_organization_notified", ["organizationId", "notified"])
    .index("by_payroll_run_notified", ["payrollRunId", "notified"])
    .index("by_payslip", ["payslipId"]),

  evaluationTemplates: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    reviewCycle: v.optional(v.string()),
    sections: v.array(
      v.object({
        label: v.string(),
        weight: v.optional(v.number()),
      }),
    ),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  evaluationSchedules: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    templateId: v.optional(v.id("evaluationTemplates")),
    title: v.string(),
    cadenceKind: v.union(
      v.literal("quarterly"),
      v.literal("semiannual"),
      v.literal("annual"),
      v.literal("custom"),
    ),
    intervalMonths: v.optional(v.number()),
    nextDueAt: v.number(),
    reviewerIds: v.array(v.id("users")),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"])
    .index("by_organization_active_due", [
      "organizationId",
      "isActive",
      "nextDueAt",
    ]),

  // Evaluations table (employee performance evaluations)
  evaluations: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    templateId: v.optional(v.id("evaluationTemplates")),
    scheduleId: v.optional(v.id("evaluationSchedules")),
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    scheduledFor: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("users")),
    cancellationReason: v.optional(v.string()),
    nextEvaluationId: v.optional(v.id("evaluations")),
    evaluationDate: v.number(), // Unix timestamp
    label: v.string(), // e.g. "1st month", "6th month", "Annual"
    reviewCycle: v.optional(v.string()),
    rating: v.optional(v.number()), // 1-5 rating for this evaluation
    outcome: v.optional(
      v.union(
        v.literal("exceeds_expectations"),
        v.literal("meets_expectations"),
        v.literal("partially_meets_expectations"),
        v.literal("does_not_meet_expectations"),
      ),
    ),
    followUpDate: v.optional(v.number()),
    attachmentUrl: v.optional(v.string()), // link to external file (Drive, etc.)
    notes: v.optional(v.string()),
    selfReview: v.optional(
      v.object({
        rating: v.optional(v.number()),
        notes: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
      }),
    ),
    managerReview: v.optional(
      v.object({
        rating: v.optional(v.number()),
        notes: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
        reviewerId: v.optional(v.id("users")),
      }),
    ),
    lockedAt: v.optional(v.number()),
    lockedBy: v.optional(v.id("users")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_employee", ["employeeId"])
    .index("by_schedule", ["scheduleId"]),

  // Leave requests table
  leavePolicies: defineTable({
    organizationId: v.id("organizations"),
    sourceKey: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.union(
      v.literal("company"),
      v.literal("statutory"),
      v.literal("unpaid"),
    ),
    confidentiality: v.union(v.literal("standard"), v.literal("restricted")),
    state: v.union(v.literal("active"), v.literal("archived")),
    complianceRole: v.optional(v.string()),
    createdBy: v.id("users"),
    archivedBy: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_source_key", ["organizationId", "sourceKey"])
    .index("by_organization_state", ["organizationId", "state"]),

  leaveMigrationRuns: defineTable({
    organizationId: v.id("organizations"),
    key: v.literal("leave-engine-v2"),
    version: v.number(),
    status: v.union(
      v.literal("migrating"),
      v.literal("auditing"),
      v.literal("ready"),
      v.literal("reconciliation_required"),
      v.literal("active"),
    ),
    cutoverCandidateAt: v.number(),
    employmentSector: v.optional(
      v.union(v.literal("private"), v.literal("government")),
    ),
    leaveTrackerMode: v.union(v.literal("general"), v.literal("by_type")),
    proratedLeave: v.optional(v.boolean()),
    leaveAccrualFrequency: v.optional(
      v.union(
        v.literal("monthly"),
        v.literal("semi_annual"),
        v.literal("annual"),
      ),
    ),
    enableAnniversaryLeave: v.optional(v.boolean()),
    anniversaryLeaveMaxDays: v.optional(v.number()),
    maxConvertibleLeaveDays: v.optional(v.number()),
    annualSil: v.optional(v.number()),
    grantLeaveUponRegularization: v.optional(v.boolean()),
    paidLeaveRequiresRegularization: v.optional(v.boolean()),
    leaveGuidelines: v.optional(v.string()),
    leaveRequestFormTemplate: v.optional(v.string()),
    legacyLeaveTypes: v.array(
      v.object({
        sourceKey: v.string(),
        name: v.string(),
        maxDays: v.optional(v.number()),
        isPaid: v.boolean(),
        accrualRate: v.optional(v.number()),
        defaultCredits: v.optional(v.number()),
        maxConsecutiveDays: v.optional(v.number()),
        carryOver: v.optional(v.boolean()),
        maxCarryOver: v.optional(v.number()),
        isAnniversary: v.optional(v.boolean()),
      }),
    ),
    sourceBalanceCount: v.number(),
    sourceRequestCount: v.number(),
    sourcePolicyCount: v.number(),
    reconciliationRequired: v.boolean(),
    snapshotPhase: v.union(
      v.literal("balances"),
      v.literal("requests"),
      v.literal("complete"),
    ),
    snapshotCursor: v.optional(v.string()),
    migrationPhase: v.union(
      v.literal("balances"),
      v.literal("requests"),
      v.literal("complete"),
    ),
    migrationCursor: v.optional(v.string()),
    auditPhase: v.union(
      v.literal("balances"),
      v.literal("requests"),
      v.literal("complete"),
    ),
    auditCursor: v.optional(v.string()),
    auditedBalanceCount: v.number(),
    auditedRequestCount: v.number(),
    sourceDriftMismatches: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_organization_key", ["organizationId", "key"])
    .index("by_organization_status", ["organizationId", "status"]),

  leaveMigrationBalanceSnapshots: defineTable({
    migrationRunId: v.id("leaveMigrationRuns"),
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    year: v.number(),
    sourceBalanceIds: v.array(v.id("employeeLeaveBalances")),
    sourceRowDigests: v.array(v.string()),
    sourceLeaveTypeKeys: v.array(v.string()),
    policySourceKey: v.string(),
    accountBehavior: v.union(
      v.literal("shared_pool"),
      v.literal("individual_account"),
    ),
    poolKey: v.optional(v.string()),
    total: v.number(),
    used: v.number(),
    balance: v.number(),
    reconciliationAmount: v.number(),
    reconciliationStatus: v.union(
      v.literal("matching"),
      v.literal("reconciliation_required"),
    ),
    createdAt: v.number(),
  })
    .index("by_run_employee_year_account", [
      "migrationRunId",
      "employeeId",
      "year",
      "policySourceKey",
    ])
    .index("by_organization_run", ["organizationId", "migrationRunId"]),

  leaveMigrationRequestSnapshots: defineTable({
    migrationRunId: v.id("leaveMigrationRuns"),
    organizationId: v.id("organizations"),
    leaveRequestId: v.id("leaveRequests"),
    employeeId: v.id("employees"),
    status: v.string(),
    numberOfDays: v.number(),
    policyId: v.optional(v.id("leavePolicies")),
    policyVersionId: v.optional(v.id("leavePolicyVersions")),
    sourceDigest: v.string(),
    createdAt: v.number(),
  })
    .index("by_run_request", ["migrationRunId", "leaveRequestId"])
    .index("by_organization_run", ["organizationId", "migrationRunId"]),

  leavePolicyVersions: defineTable({
    organizationId: v.id("organizations"),
    leavePolicyId: v.id("leavePolicies"),
    version: v.number(),
    effectiveStart: v.number(),
    effectiveEnd: v.optional(v.number()),
    accountBehavior: v.union(
      v.literal("shared_pool"),
      v.literal("individual_account"),
      v.literal("non_credit"),
    ),
    poolKey: v.optional(v.string()),
    payTreatment: v.union(
      v.literal("company_paid"),
      v.literal("statutory_paid"),
      v.literal("government_paid"),
      v.literal("statutory_benefit_supported"),
      v.literal("unpaid"),
    ),
    durationBasis: v.union(
      v.literal("scheduled_work"),
      v.literal("calendar_days"),
      v.literal("event_defined"),
    ),
    entitlementMethod: v.union(
      v.literal("annual"),
      v.literal("monthly"),
      v.literal("semi_annual"),
      v.literal("anniversary"),
      v.literal("event_based"),
      v.literal("none"),
    ),
    annualUnits: v.optional(v.number()),
    accrualRate: v.optional(v.number()),
    eligibilityBasis: v.union(
      v.literal("hire_date"),
      v.literal("regularization_date"),
      v.literal("verified_qualification"),
      v.literal("event"),
    ),
    completedServiceMonths: v.number(),
    prorationMethod: v.union(
      v.literal("none"),
      v.literal("calendar_months"),
      v.literal("actual_days"),
      v.literal("legacy_15th_day"),
    ),
    roundingIncrement: v.number(),
    carryoverMode: v.union(
      v.literal("none"),
      v.literal("capped"),
      v.literal("unlimited"),
    ),
    carryoverCap: v.optional(v.number()),
    balanceCap: v.optional(v.number()),
    expirationMode: v.optional(
      v.union(
        v.literal("none"),
        v.literal("period_end"),
        v.literal("rolling_months"),
      ),
    ),
    expirationMonths: v.optional(v.number()),
    conversionAllowed: v.boolean(),
    maxConvertibleUnits: v.optional(v.number()),
    maximumConsecutiveUnits: v.optional(v.number()),
    minimumNoticeDays: v.optional(v.number()),
    requiredDocumentRules: v.optional(
      v.array(
        v.object({
          documentType: v.string(),
          minimumDuration: v.optional(v.number()),
          requiredBefore: v.union(
            v.literal("submission"),
            v.literal("approval"),
          ),
        }),
      ),
    ),
    qualifyingEventRequired: v.optional(v.boolean()),
    maximumUnitsPerEvent: v.optional(v.number()),
    maximumUnitsPerYear: v.optional(v.number()),
    eventUseWindowDays: v.optional(v.number()),
    sourceCitation: v.optional(v.string()),
    sourceEffectiveDate: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    changeReason: v.string(),
  })
    .index("by_policy_version", ["leavePolicyId", "version"])
    .index("by_policy_effective", ["leavePolicyId", "effectiveStart"])
    .index("by_organization_effective", ["organizationId", "effectiveStart"]),

  leaveLedgerEntries: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    balanceId: v.id("employeeLeaveBalances"),
    policyVersionId: v.id("leavePolicyVersions"),
    effectiveDate: v.number(),
    kind: v.union(
      v.literal("opening_grant"),
      v.literal("opening_usage"),
      v.literal("grant"),
      v.literal("accrual"),
      v.literal("reservation"),
      v.literal("reservation_release"),
      v.literal("usage"),
      v.literal("restoration"),
      v.literal("adjustment"),
      v.literal("carryover"),
      v.literal("expiration"),
      v.literal("conversion"),
      v.literal("migration_reconciliation"),
    ),
    amount: v.number(),
    unit: v.union(v.literal("day"), v.literal("hour")),
    referenceType: v.optional(
      v.union(
        v.literal("request"),
        v.literal("conversion"),
        v.literal("payroll"),
        v.literal("migration"),
        v.literal("correction"),
      ),
    ),
    leaveRequestId: v.optional(v.id("leaveRequests")),
    leaveConversionRequestId: v.optional(v.id("leaveConversionRequests")),
    payrollRunId: v.optional(v.id("payrollRuns")),
    migrationRunId: v.optional(v.id("migrationRuns")),
    leaveMigrationRunId: v.optional(v.id("leaveMigrationRuns")),
    actorId: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    idempotencyKey: v.string(),
    reversalOfEntryId: v.optional(v.id("leaveLedgerEntries")),
    createdAt: v.number(),
  })
    .index("by_balance_effective", ["balanceId", "effectiveDate"])
    .index("by_employee_effective", ["employeeId", "effectiveDate"])
    .index("by_request", ["leaveRequestId"])
    .index("by_organization_idempotency_key", [
      "organizationId",
      "idempotencyKey",
    ]),

  leaveRequests: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveType: v.union(
      v.literal("vacation"),
      v.literal("sick"),
      v.literal("emergency"),
      v.literal("maternity"),
      v.literal("paternity"),
      v.literal("custom"),
    ),
    customLeaveType: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    numberOfDays: v.number(),
    reason: v.string(),
    formTemplateContent: v.optional(v.string()),
    filledFormContent: v.optional(v.string()),
    signatureDataUrl: v.optional(v.string()),
    isPaid: v.optional(v.boolean()),
    isManual: v.optional(v.boolean()),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancellation_requested"),
      v.literal("cancelled"),
      v.literal("corrected"),
    ),
    policyId: v.optional(v.id("leavePolicies")),
    policyVersionId: v.optional(v.id("leavePolicyVersions")),
    benefitEventId: v.optional(v.id("leaveBenefitEvents")),
    requestedStart: v.optional(v.number()),
    requestedEnd: v.optional(v.number()),
    requestedDurationMode: v.optional(
      v.union(v.literal("day"), v.literal("half_day"), v.literal("hour")),
    ),
    chargeableDuration: v.optional(v.number()),
    payTreatment: v.optional(
      v.union(
        v.literal("company_paid"),
        v.literal("statutory_paid"),
        v.literal("government_paid"),
        v.literal("statutory_benefit_supported"),
        v.literal("unpaid"),
      ),
    ),
    submittedBy: v.optional(v.id("users")),
    reviewerId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    decisionReason: v.optional(v.string()),
    reviewerSnapshot: v.optional(
      v.object({
        displayName: v.string(),
        position: v.optional(v.string()),
      }),
    ),
    cancellationRequestedBy: v.optional(v.id("users")),
    cancellationRequestedAt: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
    cancelledBy: v.optional(v.id("users")),
    cancelledAt: v.optional(v.number()),
    engineVersion: v.optional(v.number()),
    cutoverAt: v.optional(v.number()),
    filedDate: v.number(),
    reviewedBy: v.optional(v.id("users")),
    reviewedDate: v.optional(v.number()),
    remarks: v.optional(v.string()),
    approvedByName: v.optional(v.string()),
    reviewerPosition: v.optional(v.string()),
    reviewerSignatureDataUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_status", ["status"])
    .index("by_organization", ["organizationId"])
    .index("by_organization_status_created", [
      "organizationId",
      "status",
      "createdAt",
    ])
    .index("by_date_range", ["startDate", "endDate"])
    // Payroll: approved leaves that can overlap a pay period (endDate gte period start) without scanning full history
    .index("by_employee_status_endDate", ["employeeId", "status", "endDate"]),

  leaveRequestOccurrences: defineTable({
    leaveRequestId: v.id("leaveRequests"),
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    localDate: v.string(),
    scheduleSnapshot: v.object({
      isWorkday: v.boolean(),
      scheduledMinutes: v.number(),
      shiftId: v.optional(v.id("shifts")),
    }),
    holidaySnapshot: v.object({
      isHoliday: v.boolean(),
      holidayId: v.optional(v.id("holidays")),
      holidayType: v.optional(v.string()),
    }),
    scheduledMinutes: v.number(),
    leaveMinutes: v.number(),
    creditAmount: v.number(),
    payTreatment: v.union(
      v.literal("company_paid"),
      v.literal("statutory_paid"),
      v.literal("government_paid"),
      v.literal("statutory_benefit_supported"),
      v.literal("unpaid"),
    ),
    lifecycleState: v.union(
      v.literal("reserved"),
      v.literal("approved"),
      v.literal("cancelled"),
      v.literal("corrected"),
    ),
    attendanceConflictState: v.union(
      v.literal("none"),
      v.literal("detected"),
      v.literal("resolved"),
    ),
    payrollRunId: v.optional(v.id("payrollRuns")),
    payrollLockedAt: v.optional(v.number()),
    payrollReference: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_local_date", ["employeeId", "localDate"])
    .index("by_organization_local_date", ["organizationId", "localDate"])
    .index("by_request_local_date", ["leaveRequestId", "localDate"])
    .index("by_payroll_run", ["payrollRunId"]),

  leaveRequestEvents: defineTable({
    leaveRequestId: v.id("leaveRequests"),
    organizationId: v.id("organizations"),
    type: v.union(
      v.literal("submitted"),
      v.literal("reviewed"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancellation_requested"),
      v.literal("cancelled"),
      v.literal("corrected"),
      v.literal("document_verified"),
      v.literal("notification_sent"),
    ),
    actorId: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_request_created", ["leaveRequestId", "createdAt"])
    .index("by_organization_created", ["organizationId", "createdAt"]),

  employeeLeaveQualifications: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    qualificationType: v.string(),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),
    verificationStatus: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    submittedBy: v.id("users"),
    verifiedBy: v.optional(v.id("users")),
    verifiedAt: v.optional(v.number()),
    documentReferences: v.optional(v.array(v.id("storageObjects"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_type_valid_from", [
      "employeeId",
      "qualificationType",
      "validFrom",
    ])
    .index("by_organization_status", ["organizationId", "verificationStatus"]),

  leaveBenefitEvents: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    eventType: v.union(
      v.literal("maternity"),
      v.literal("miscarriage"),
      v.literal("emergency_termination_of_pregnancy"),
      v.literal("spouse_delivery"),
      v.literal("maternity_credit_allocation"),
      v.literal("surgery"),
      v.literal("adoption"),
      v.literal("calamity"),
      v.literal("other_protected"),
    ),
    qualifyingDate: v.number(),
    benefitVariant: v.optional(v.string()),
    verificationStatus: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("rejected"),
    ),
    verifiedBy: v.optional(v.id("users")),
    verifiedAt: v.optional(v.number()),
    documentReferences: v.optional(v.array(v.id("storageObjects"))),
    allocatedFromEventId: v.optional(v.id("leaveBenefitEvents")),
    allocatedToEmployeeId: v.optional(v.id("employees")),
    allocatedDays: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_type_qualifying_date", [
      "employeeId",
      "eventType",
      "qualifyingDate",
    ])
    .index("by_organization_qualifying_date", [
      "organizationId",
      "qualifyingDate",
    ])
    .index("by_allocation_source", ["allocatedFromEventId"]),

  leaveBenefitPayrollReconciliations: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveRequestId: v.id("leaveRequests"),
    expectedGrossBenefitAmount: v.number(),
    employerAdvanceAmount: v.number(),
    externalBenefitAmount: v.number(),
    salaryDifferentialAmount: v.number(),
    reimbursedAmount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("advanced"),
      v.literal("partially_reimbursed"),
      v.literal("reconciled"),
      v.literal("waived"),
      v.literal("voided"),
    ),
    referenceNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_request", ["leaveRequestId"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_employee", ["employeeId"]),

  leaveBenefitPayrollAllocations: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    leaveRequestId: v.id("leaveRequests"),
    reconciliationId: v.id("leaveBenefitPayrollReconciliations"),
    payrollRunId: v.id("payrollRuns"),
    payslipId: v.id("payslips"),
    attributedPay: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reconciliation", ["reconciliationId"])
    .index("by_payroll_run", ["payrollRunId"])
    .index("by_payslip", ["payslipId"])
    .index("by_request_payroll_run", ["leaveRequestId", "payrollRunId"]),

  leaveSensitiveAccessGrants: defineTable({
    organizationId: v.id("organizations"),
    membershipId: v.id("userOrganizations"),
    isActive: v.boolean(),
    grantedBy: v.id("users"),
    grantedAt: v.number(),
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_membership_active", ["membershipId", "isActive"])
    .index("by_organization_active", ["organizationId", "isActive"]),

  leaveAdministrativeEvents: defineTable({
    organizationId: v.id("organizations"),
    type: v.union(
      v.literal("sensitive_access_granted"),
      v.literal("sensitive_access_revoked"),
    ),
    membershipId: v.id("userOrganizations"),
    actorId: v.id("users"),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_membership_created", ["membershipId", "createdAt"]),

  leaveConversionRequests: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    balanceId: v.id("employeeLeaveBalances"),
    policyId: v.id("leavePolicies"),
    policyVersionId: v.id("leavePolicyVersions"),
    requestedDays: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
      v.literal("paid"),
    ),
    requestedBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionReason: v.optional(v.string()),
    ledgerEntryId: v.optional(v.id("leaveLedgerEntries")),
    dailyRateSnapshot: v.optional(v.number()),
    payableAmount: v.optional(v.number()),
    payrollRunId: v.optional(v.id("payrollRuns")),
    finalSettlementId: v.optional(v.id("finalSettlements")),
    paymentStatus: v.union(
      v.literal("not_ready"),
      v.literal("ready"),
      v.literal("processing"),
      v.literal("paid"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_employee_status", ["employeeId", "status"])
    .index("by_payroll_run", ["payrollRunId"])
    .index("by_final_settlement", ["finalSettlementId"]),

  // Leave types table (custom leave types)
  leaveTypes: defineTable({
    organizationId: v.id("organizations"),
    sourceKey: v.optional(v.string()),
    name: v.string(),
    maxDays: v.optional(v.number()),
    requiresApproval: v.boolean(),
    isPaid: v.boolean(),
    accrualRate: v.optional(v.number()), // Days per month
    defaultCredits: v.optional(v.number()),
    maxConsecutiveDays: v.optional(v.number()),
    carryOver: v.optional(v.boolean()),
    maxCarryOver: v.optional(v.number()),
    isAnniversary: v.optional(v.boolean()),
    migrationVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_source_key", ["organizationId", "sourceKey"]),

  // Job postings table
  jobs: defineTable({
    organizationId: v.id("organizations"),
    title: v.string(),
    department: v.string(),
    position: v.string(),
    employmentType: v.string(),
    numberOfOpenings: v.number(),
    description: v.string(),
    requirements: v.array(v.string()),
    qualifications: v.array(v.string()),
    salaryRange: v.optional(
      v.object({
        min: v.number(),
        max: v.number(),
      }),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("on-hold"),
    ),
    postedDate: v.number(),
    closingDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_status", ["status"]),

  // Applicants table
  applicants: defineTable({
    organizationId: v.id("organizations"),
    jobId: v.id("jobs"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    resume: v.id("_storage"),
    coverLetter: v.optional(v.string()),
    source: v.optional(v.string()),
    sourceDetails: v.optional(v.string()),
    status: v.union(
      v.literal("new"),
      v.literal("screening"),
      v.literal("interview"),
      v.literal("assessment"),
      v.literal("offer"),
      v.literal("hired"),
      v.literal("rejected"),
    ),
    appliedDate: v.number(),
    convertedEmployeeId: v.optional(v.id("employees")),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    currentStageChangedAt: v.optional(v.number()),
    rating: v.optional(v.number()),
    googleMeetLink: v.optional(v.string()),
    interviewVideoLink: v.optional(v.string()),
    portfolioLink: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_status", ["status"])
    .index("by_organization", ["organizationId"]),

  // Memo templates table
  memoTemplates: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    title: v.string(),
    content: v.string(), // Rich text JSON (Tiptap)
    category: v.union(
      v.literal("disciplinary"),
      v.literal("holidays"),
      v.literal("company-policies"),
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other"),
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent"),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_category", ["category"]),

  // Memos table
  memos: defineTable({
    organizationId: v.id("organizations"),
    title: v.string(),
    content: v.string(), // Rich text JSON
    category: v.optional(
      v.union(
        v.literal("disciplinary"),
        v.literal("holidays"),
        v.literal("company-policies"),
      ),
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other"),
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent"),
    ),
    author: v.id("users"),
    authorDisplayName: v.optional(v.string()),
    authorPersona: v.optional(
      v.union(v.literal("admin"), v.literal("employee"), v.literal("member")),
    ),
    authorEmployeeId: v.optional(v.id("employees")),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees"),
    ),
    publishedDate: v.number(),
    scheduledPublishDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    reminderCadenceDays: v.optional(v.number()),
    reminderLastSentAt: v.optional(v.number()),
    reminderLastSentBy: v.optional(v.id("users")),
    audienceSnapshot: v.optional(
      v.object({
        count: v.number(),
        generatedAt: v.number(),
      }),
    ),
    isPublished: v.boolean(),
    acknowledgementRequired: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_published", ["isPublished"])
    .index("by_date", ["publishedDate"]),

  memoReactions: defineTable({
    organizationId: v.id("organizations"),
    memoId: v.id("memos"),
    userId: v.id("users"),
    emoji: v.string(),
    reactedAt: v.number(),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_memo", ["memoId"])
    .index("by_memo_user_emoji", ["memoId", "userId", "emoji"]),

  memoAcknowledgements: defineTable({
    organizationId: v.id("organizations"),
    memoId: v.id("memos"),
    employeeId: v.id("employees"),
    acknowledgedAt: v.number(),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_memo", ["memoId"])
    .index("by_memo_employee", ["memoId", "employeeId"]),

  memoAudienceMembers: defineTable({
    organizationId: v.id("organizations"),
    memoId: v.id("memos"),
    audienceType: v.union(v.literal("employee"), v.literal("department")),
    employeeId: v.optional(v.id("employees")),
    department: v.optional(v.string()),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_memo", ["memoId"])
    .index("by_memo_employee", ["memoId", "employeeId"])
    .index("by_memo_department", ["memoId", "department"]),

  // Announcement comments (only org members can view and post)
  announcementComments: defineTable({
    announcementId: v.id("memos"),
    parentCommentId: v.optional(v.id("announcementComments")),
    organizationId: v.id("organizations"),
    author: v.id("users"),
    authorDisplayName: v.optional(v.string()),
    authorPersona: v.optional(
      v.union(v.literal("admin"), v.literal("employee"), v.literal("member")),
    ),
    authorEmployeeId: v.optional(v.id("employees")),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_announcement", ["announcementId"])
    .index("by_organization", ["organizationId"]),

  // When user last viewed announcements (for unread badge)
  announcementLastSeen: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_organization", ["userId", "organizationId"]),

  // Settings identity shell retained for normalized settings targets.
  settings: defineTable({
    organizationId: v.id("organizations"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // Chat conversations
  conversations: defineTable({
    organizationId: v.id("organizations"),
    type: v.union(
      v.literal("direct"),
      v.literal("group"),
      v.literal("channel"),
    ),
    name: v.optional(v.string()), // For group chats and channels
    createdBy: v.optional(v.id("users")), // User who created the group/channel
    channelScope: v.optional(
      v.union(v.literal("organization"), v.literal("personal")),
    ), // Only for type "channel"
    lastMessageAt: v.optional(v.number()),
    /** AES-256 session key for message bodies, wrapped with org KEK (see chatSessionKey.ts). */
    chatSessionKeyEnc: v.optional(v.string()),
    /** Direct DM variant: staff official thread (shows as "Admin" to the other party). */
    directThreadKind: v.optional(
      v.union(v.literal("standard"), v.literal("staff_as_admin")),
    ),
    /** For staff_as_admin threads: user whose messages appear as Admin. */
    adminPersonaUserId: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // Chat messages
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    content: v.string(),
    messageType: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("file"),
      v.literal("system"),
    ),
    payslipId: v.optional(v.id("payslips")), // Link message to payslip for appeals/comments
    replyToMessageId: v.optional(v.id("messages")), // When replying to a specific message
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    deletionKind: v.optional(
      v.union(v.literal("author"), v.literal("moderator")),
    ),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_created_at", ["conversationId", "createdAt"])
    .index("by_sender", ["senderId"])
    .index("by_payslip", ["payslipId"]),

  messageReactions: defineTable({
    organizationId: v.id("organizations"),
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  // User chat preferences
  userChatPreferences: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_organization", ["userId", "organizationId"]),

  conversationMembers: defineTable({
    organizationId: v.id("organizations"),
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    status: v.literal("active"),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messageReceipts: defineTable({
    organizationId: v.id("organizations"),
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    userId: v.id("users"),
    state: v.literal("read"),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_message", ["messageId"])
    .index("by_message_user", ["messageId", "userId"]),

  userPinnedConversations: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    conversationId: v.id("conversations"),
    sourcePreferencesId: v.id("userChatPreferences"),
    position: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_user_organization", ["userId", "organizationId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  userConversationPreferences: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    conversationId: v.id("conversations"),
    muted: v.boolean(),
    lastReadAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_organization", ["userId", "organizationId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  // Invitations
  invitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    invitedBy: v.id("users"),
    employeeId: v.optional(v.id("employees")), // Link to employee if applicable
    inviteeName: v.optional(v.string()), // Name from employee record for pre-filled user on accept
    tokenHash: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_email", ["email"])
    .index("by_token_hash", ["tokenHash"]),

  // Documents
  documents: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")), // If document belongs to specific employee
    createdBy: v.id("users"), // User who created the document
    title: v.string(),
    content: v.string(), // Rich text content (JSON from TipTap)
    type: v.union(
      v.literal("personal"),
      v.literal("employment"),
      v.literal("contract"),
      v.literal("certificate"),
      v.literal("leave_form"),
      v.literal("other"),
    ),
    category: v.optional(v.string()),
    isShared: v.optional(v.boolean()), // If shared with HR/Admin
    visibilityScope: v.optional(
      v.union(
        v.literal("admins_only"),
        v.literal("all_employees"),
        v.literal("department"),
        v.literal("specific_employee"),
        v.literal("alumni_visible"),
        v.literal("payroll_visible"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** Increments when body content is replaced; first version is 1. Used for version history. */
    contentVersion: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"])
    .index("by_creator", ["createdBy"]),

  documentAccessGrants: defineTable({
    organizationId: v.id("organizations"),
    documentId: v.id("documents"),
    grantType: v.union(
      v.literal("user"),
      v.literal("employee"),
      v.literal("department"),
    ),
    userId: v.optional(v.id("users")),
    employeeId: v.optional(v.id("employees")),
    department: v.optional(v.string()),
    sourceField: v.union(
      v.literal("sharedWith"),
      v.literal("visibleEmployeeIds"),
      v.literal("visibleDepartments"),
    ),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_document", ["documentId"])
    .index("by_document_user", ["documentId", "userId"])
    .index("by_document_employee", ["documentId", "employeeId"])
    .index("by_document_department", ["documentId", "department"]),

  /** Past snapshots when a Plinth document's body is edited; announcements use copied content, not this table. */
  documentVersions: defineTable({
    documentId: v.id("documents"),
    organizationId: v.id("organizations"),
    version: v.number(),
    title: v.string(),
    content: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_document", ["documentId"])
    .index("by_organization", ["organizationId"]),

  // Accounting cost items (categoryName: "Employee Related Cost" | "Operational Cost")
  accountingCostItems: defineTable({
    organizationId: v.id("organizations"),
    payrollRunId: v.optional(v.id("payrollRuns")), // When set, this cost is tied to a payroll run (e.g. payroll/SSS expense)
    sourceType: v.optional(
      v.union(v.literal("manual"), v.literal("payroll_run")),
    ),
    sourceKey: v.optional(v.string()),
    sourceUpdatedAt: v.optional(v.number()),
    categoryName: v.optional(v.string()), // "Employee Related Cost" | "Operational Cost"
    name: v.string(), // e.g., "Payroll", "Rent", "Utilities"
    description: v.optional(v.string()),
    amount: v.number(), // Total amount/cost
    amountPaid: v.number(), // Amount paid so far (default 0)
    frequency: v.union(
      v.literal("one-time"),
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("yearly"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("partial"),
      v.literal("paid"),
      v.literal("overdue"),
    ),
    dueDate: v.optional(v.number()), // Timestamp
    breakdown: v.optional(
      v.object({
        kind: v.union(v.literal("payroll"), v.literal("contributions")),
        rows: v.array(
          v.object({
            employeeId: v.id("employees"),
            employeeName: v.string(),
            employeeAmount: v.optional(v.number()),
            companyAmount: v.optional(v.number()),
            grossPay: v.optional(v.number()),
            nonTaxableAllowance: v.optional(v.number()),
            totalIncentives: v.optional(v.number()),
            totalDeductions: v.optional(v.number()),
            incentiveItems: v.optional(
              v.array(
                v.object({
                  name: v.string(),
                  amount: v.number(),
                  type: v.optional(v.string()),
                }),
              ),
            ),
            deductionItems: v.optional(
              v.array(
                v.object({
                  name: v.string(),
                  amount: v.number(),
                  type: v.optional(v.string()),
                }),
              ),
            ),
            netPay: v.optional(v.number()),
          }),
        ),
      }),
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_source", ["organizationId", "sourceType", "sourceKey"])
    .index("by_categoryName", ["categoryName"])
    .index("by_status", ["status"])
    .index("by_due_date", ["dueDate"]),

  // Assets
  assets: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
    totalValue: v.optional(v.number()),
    datePurchased: v.optional(v.number()),
    supplier: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    condition: v.optional(
      v.union(
        v.literal("new"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("needs_repair"),
        v.literal("damaged"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("disposed"),
        v.literal("maintenance"),
      ),
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  assetCustodyEvents: defineTable({
    organizationId: v.id("organizations"),
    assetId: v.id("assets"),
    eventType: v.union(
      v.literal("assigned"),
      v.literal("acknowledged"),
      v.literal("returned"),
    ),
    employeeId: v.optional(v.id("employees")),
    actorUserId: v.optional(v.id("users")),
    occurredAt: v.number(),
    returnDueDate: v.optional(v.number()),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset", ["assetId", "occurredAt"])
    .index("by_asset_source", ["assetId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),

  assetMaintenanceEvents: defineTable({
    organizationId: v.id("organizations"),
    assetId: v.id("assets"),
    serviceDate: v.number(),
    description: v.string(),
    cost: v.optional(v.number()),
    performedBy: v.optional(v.string()),
    nextServiceDate: v.optional(v.number()),
    sourceIndex: v.number(),
    migrationVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset", ["assetId", "serviceDate"])
    .index("by_asset_source", ["assetId", "sourceIndex"])
    .index("by_organization", ["organizationId"]),
});
