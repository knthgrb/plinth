import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Organizations table
  organizations: defineTable({
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    taxId: v.optional(v.string()),
    defaultRequirements: v.optional(
      v.array(
        v.object({
          type: v.string(),
          isRequired: v.optional(v.boolean()),
        }),
      ),
    ),
    firstPayDate: v.optional(v.number()), // Day of month for first payroll (default: 15)
    secondPayDate: v.optional(v.number()), // Day of month for second payroll (default: 30)
    salaryPaymentFrequency: v.optional(
      v.union(v.literal("monthly"), v.literal("bimonthly")),
    ), // "monthly" = once per month, "bimonthly" = twice per month (e.g. 15th & 30th)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

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
    name: v.optional(v.string()),
    masterRole: v.optional(v.literal("super_admin")), // Master role: super_admin has access to /admin; null = regular user
    organizationId: v.optional(v.id("organizations")), // Deprecated: kept for backward compatibility
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("owner"),
        v.literal("hr"),
        v.literal("employee"),
        v.literal("accounting"),
      ),
    ), // Deprecated: kept for backward compatibility
    employeeId: v.optional(v.id("employees")), // Link to employee record if applicable
    isActive: v.optional(v.boolean()), // false when linked employee is archived; account cannot be used
    lastActiveOrganizationId: v.optional(v.id("organizations")), // Track user's last active organization
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_email", ["email"])
    .index("by_employee", ["employeeId"]),

  // User-Organization junction table (many-to-many relationship)
  userOrganizations: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    employeeId: v.optional(v.id("employees")), // If user is also an employee in this org
    joinedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_organization", ["organizationId"])
    .index("by_user_organization", ["userId", "organizationId"]),

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
    .index("by_user_org_unread", ["userId", "organizationId", "read"]),

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
      status: v.union(
        v.literal("active"),
        v.literal("inactive"),
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
      paymentFrequency: v.optional(v.string()), // Deprecated: kept for backward compatibility, will be removed
      bankDetails: v.optional(
        v.object({
          bankName: v.string(),
          accountNumber: v.string(),
          accountName: v.string(),
        }),
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
    // Leave credits moved to leave tracker; optional for backward compatibility
    leaveCredits: v.optional(
      v.object({
        vacation: v.object({
          total: v.number(),
          used: v.number(),
          balance: v.number(),
        }),
        sick: v.object({
          total: v.number(),
          used: v.number(),
          balance: v.number(),
        }),
        custom: v.optional(
          v.array(
            v.object({
              type: v.string(),
              total: v.number(),
              used: v.number(),
              balance: v.number(),
            }),
          ),
        ),
      }),
    ),
    requirements: v.optional(
      v.array(
        v.object({
          type: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("submitted"),
            v.literal("verified"),
          ),
          file: v.optional(v.id("_storage")),
          submittedDate: v.optional(v.number()),
          expiryDate: v.optional(v.number()),
          isDefault: v.optional(v.boolean()), // True if from organization defaults
          isCustom: v.optional(v.boolean()), // True if custom requirement for this employee
        }),
      ),
    ),
    deductions: v.optional(
      v.array(
        v.object({
          id: v.string(),
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
        }),
      ),
    ),
    incentives: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          amount: v.number(),
          frequency: v.union(
            v.literal("monthly"),
            v.literal("quarterly"),
            v.literal("one-time"),
            v.literal("per-cutoff"),
          ),
          isActive: v.boolean(),
        }),
      ),
    ),
    customFields: v.optional(v.any()), // Flexible object for custom fields
    /** Hashed PIN for accessing payslips page (e.g. SHA-256 of pin + salt). Set by employee or HR. */
    payslipPinHash: v.optional(v.string()),
    /** Optional custom password for emailed payslip PDFs. When absent, employee ID is used. */
    payslipPdfPassword: v.optional(v.string()),
    /** Optional shift (Morning, UK, Night). When set, schedule + lunch come from shift; null/absent = use defaultSchedule + org default lunch. */
    shiftId: v.optional(v.union(v.id("shifts"), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee_id", ["employment.employeeId"])
    .index("by_shift", ["shiftId"])
    .index("by_status", ["employment.status"])
    .index("by_department", ["employment.department"]),

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
    .index("by_employee_date", ["employeeId", "date"]),

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
    /** "regular" = standard payroll; "13th_month" = 13th month pay run; "leave_conversion" = leave to cash */
    runType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("13th_month"),
        v.literal("leave_conversion"),
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
        }),
      ),
    ),
    notes: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          date: v.number(),
          note: v.string(),
          addedBy: v.id("users"),
          addedAt: v.number(),
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
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_period", ["cutoffStart", "cutoffEnd"])
    .index("by_organization_runType_year", [
      "organizationId",
      "runType",
      "year",
    ]),

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
    lateHours: v.union(v.number(), v.string()),
    undertimeHours: v.union(v.number(), v.string()),
    overtimeHours: v.union(v.number(), v.string()),
    holidayPay: v.optional(v.union(v.number(), v.string())),
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
    editHistory: v.optional(
      v.array(
        v.object({
          editedBy: v.id("users"),
          editedByEmail: v.optional(v.string()),
          editedAt: v.number(),
          changes: v.array(
            v.object({
              field: v.string(),
              oldValue: v.optional(v.any()),
              newValue: v.optional(v.any()),
              details: v.optional(v.array(v.string())),
            }),
          ),
        }),
      ),
    ),
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
    createdBy: v.id("users"),
    createdAt: v.number(),
    notified: v.boolean(),
  })
    .index("by_organization_notified", ["organizationId", "notified"])
    .index("by_payroll_run_notified", ["payrollRunId", "notified"])
    .index("by_payslip", ["payslipId"]),

  // Evaluations table (employee performance evaluations)
  evaluations: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    evaluationDate: v.number(), // Unix timestamp
    label: v.string(), // e.g. "1st month", "6th month", "Annual"
    rating: v.optional(v.number()), // 1-5 rating for this evaluation
    frequencyMonths: v.optional(v.number()), // legacy/optional
    attachmentUrl: v.optional(v.string()), // link to external file (Drive, etc.)
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"]),

  // Leave requests table
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
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    supportingDocuments: v.optional(v.array(v.id("_storage"))),
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
    .index("by_date_range", ["startDate", "endDate"])
    // Payroll: approved leaves that can overlap a pay period (endDate gte period start) without scanning full history
    .index("by_employee_status_endDate", [
      "employeeId",
      "status",
      "endDate",
    ]),

  // Leave types table (custom leave types)
  leaveTypes: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    maxDays: v.optional(v.number()),
    requiresApproval: v.boolean(),
    isPaid: v.boolean(),
    accrualRate: v.optional(v.number()), // Days per month
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

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
    notes: v.optional(
      v.array(
        v.object({
          date: v.number(),
          author: v.id("users"),
          content: v.string(),
        }),
      ),
    ),
    interviewSchedules: v.optional(
      v.array(
        v.object({
          date: v.number(),
          type: v.string(),
          interviewer: v.id("users"),
          remarks: v.optional(v.string()),
        }),
      ),
    ),
    rating: v.optional(v.number()),
    googleMeetLink: v.optional(v.string()),
    interviewVideoLink: v.optional(v.string()),
    portfolioLink: v.optional(v.string()),
    customFields: v.optional(v.any()), // Flexible object for custom fields
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
    /** When set (e.g. "Admin"), announcement shows this label instead of the author's name */
    authorDisplayName: v.optional(v.string()),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees"),
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    publishedDate: v.number(),
    expiryDate: v.optional(v.number()),
    reactions: v.optional(v.array(v.any())),
    attachments: v.optional(v.array(v.id("_storage"))),
    attachmentContentTypes: v.optional(v.array(v.string())), // MIME types, same length as attachments (image/*, video/*)
    isPublished: v.boolean(),
    acknowledgementRequired: v.boolean(),
    acknowledgedBy: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          date: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_published", ["isPublished"])
    .index("by_date", ["publishedDate"]),

  // Announcement comments (only org members can view and post)
  announcementComments: defineTable({
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    author: v.id("users"),
    authorDisplayName: v.optional(v.string()), // e.g. "Admin" when commenting as admin/owner
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

  // Settings table (organization-specific configurations)
  settings: defineTable({
    organizationId: v.id("organizations"),
    cutoffDates: v.optional(
      v.object({
        firstCutoff: v.number(), // Day of month (1-15)
        secondCutoff: v.number(), // Day of month (16-31)
      }),
    ),
    payrollFrequency: v.optional(
      v.union(
        v.literal("weekly"),
        v.literal("semi-monthly"),
        v.literal("monthly"),
      ),
    ),
    taxTable: v.optional(v.string()), // Reference to tax table version
    // Attendance / lunch break (org default when employee has no shift)
    attendanceSettings: v.optional(
      v.object({
        defaultLunchBreakMinutes: v.optional(v.number()), // e.g. 60 (used when no shift or shift has no lunch)
        defaultLunchStart: v.optional(v.string()), // HH:mm e.g. "12:00"
        defaultLunchEnd: v.optional(v.string()), // HH:mm e.g. "13:00"
      }),
    ),
    // Payroll configurations
    payrollSettings: v.optional(
      v.object({
        nightDiffPercent: v.optional(v.number()), // Night differential: full rate for 10 PM–6 AM (default 1.1 = 110%, same convention as other night diff rates)
        regularHolidayRate: v.optional(v.number()), // Actual rate for regular holidays (default 2.0 = 200% of daily)
        specialHolidayRate: v.optional(v.number()), // Actual rate for special holidays (default 1.3 = 130% of daily)
        overtimeRegularRate: v.optional(v.number()), // Regular day OT multiplier (default 1.25 = 125% per hour)
        overtimeRestDayRate: v.optional(v.number()), // Rest day OT multiplier (default 1.69 = 169%)
        regularHolidayOtRate: v.optional(v.number()), // Regular holiday OT multiplier (default 2.0 = 200%)
        specialHolidayOtRate: v.optional(v.number()), // Special holiday OT multiplier (default 1.69 = 169%)
        // Night differential rates (apply to hours in 10pm–6am; holiday rates apply only to hours on the holiday calendar day)
        nightDiffOnOtRate: v.optional(v.number()), // Night diff on top of OT (default 1.375 = 137.5% of hourly)
        nightDiffRegularHolidayRate: v.optional(v.number()), // Night hours on regular holiday (default 2.2 = 220%)
        nightDiffSpecialHolidayRate: v.optional(v.number()), // Night hours on special non-working holiday (default 1.43 = 143%)
        nightDiffRegularHolidayOtRate: v.optional(v.number()), // Regular holiday + OT + night (default 2.86 = 286%)
        nightDiffSpecialHolidayOtRate: v.optional(v.number()), // Special holiday + OT + night (default 1.859 = 185.9%)
        // Daily rate from monthly: (basic + allowance?) × (12 / workingDaysPerYear)
        dailyRateIncludesAllowance: v.optional(v.boolean()), // If true, daily rate = (basic + allowance) × 12/261 (default true)
        dailyRateWorkingDaysPerYear: v.optional(v.number()), // Working days per year for daily rate (default 261)
        // Tax deduction: once_per_month = full tax on one pay; twice_per_month = half on 1st, half on 2nd (bimonthly only)
        taxDeductionFrequency: v.optional(
          v.union(v.literal("once_per_month"), v.literal("twice_per_month")),
        ),
        // When once_per_month: which pay deducts full tax (first = 1st cutoff, second = 2nd cutoff)
        taxDeductOnPay: v.optional(
          v.union(v.literal("first"), v.literal("second")),
        ),
        // Holiday with "no_work" attendance status: if true, treat as no-work-no-pay (deduct daily pay for monthly).
        // Default false = no-work-with-pay (no absence deduction).
        holidayNoWorkNoPay: v.optional(v.boolean()),
        // If true, employee gets no holiday additional pay when absent the day before the holiday.
        // Default true.
        absentBeforeHolidayNoHolidayPay: v.optional(v.boolean()),
        /**
         * When true, additions marked non-taxable are applied against the TRAIN Law annual
         * ₱90,000 non-taxable benefits cap; the excess is shown as taxable.
         */
        trainNinetyThousandCapOnAdditions: v.optional(v.boolean()),
      }),
    ),
    // Leave type configurations
    leaveTypes: v.optional(
      v.array(
        v.object({
          type: v.string(), // e.g., "vacation", "sick", "maternity", "paternity", "anniversary", "emergency", "custom"
          name: v.string(), // Display name
          defaultCredits: v.number(), // Default credits per year (0 for anniversary - accrues +1 per year from hire)
          isPaid: v.boolean(), // Whether this leave type is paid
          requiresApproval: v.boolean(), // Whether this leave requires approval
          maxConsecutiveDays: v.optional(v.number()), // Maximum consecutive days allowed
          carryOver: v.optional(v.boolean()), // Whether unused credits can carry over
          maxCarryOver: v.optional(v.number()), // Maximum credits that can carry over
          isAnniversary: v.optional(v.boolean()), // When true, accrues +1 per year from hire/regularization date
        }),
      ),
    ),
    // Prorated leave: when true, annual leave is prorated by months worked (e.g. new hires get (annual/12)*months)
    proratedLeave: v.optional(v.boolean()),
    // Leave tracker mode: "general" uses Annual SIL base, "by_type" uses configured leave types sum.
    leaveTrackerMode: v.optional(
      v.union(v.literal("general"), v.literal("by_type")),
    ),
    // When true, anniversary leave is included in tracker totals.
    enableAnniversaryLeave: v.optional(v.boolean()),
    // Max unused leave days convertible to cash (default 5)
    maxConvertibleLeaveDays: v.optional(v.number()),
    // Base annual SIL used by leave tracker formulas
    annualSil: v.optional(v.number()),
    // When true, proration starts from regularization date; when false, from hire date
    grantLeaveUponRegularization: v.optional(v.boolean()),
    // Leave request form template (Tiptap JSON string)
    leaveRequestFormTemplate: v.optional(v.string()),
    // PDF export: optional header/footer (text or inline image) for leave request PDFs
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
    // Leave tracker sheet overrides keyed by employee (legacy, no year)
    leaveTrackerRows: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          annualSilOverride: v.optional(v.number()),
          availed: v.optional(v.number()),
        }),
      ),
    ),
    // Leave tracker by year: { year, rows[] } for historical tracking
    leaveTrackerByYear: v.optional(
      v.array(
        v.object({
          year: v.number(),
          rows: v.array(
            v.object({
              employeeId: v.id("employees"),
              annualSilOverride: v.optional(v.number()),
              availed: v.optional(v.number()),
            }),
          ),
        }),
      ),
    ),
    // Organization departments
    // Temporarily accept both old format (string[]) and new format (Department[])
    // Migration will happen automatically in queries/mutations
    departments: v.optional(
      v.union(
        v.array(v.string()),
        v.array(
          v.object({
            name: v.string(),
            color: v.string(), // HEX color code
          }),
        ),
      ),
    ),
    // Evaluation columns configuration
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
    // Recruitment table columns configuration
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
    // Requirements table columns configuration
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
    // Leave table columns configuration
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
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // Chat conversations
  conversations: defineTable({
    organizationId: v.id("organizations"),
    participants: v.array(v.id("users")), // Users in the conversation (for channel = members who joined)
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_participant", ["participants"]),

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
    attachments: v.optional(v.array(v.id("_storage"))),
    payslipId: v.optional(v.id("payslips")), // Link message to payslip for appeals/comments
    replyToMessageId: v.optional(v.id("messages")), // When replying to a specific message
    readBy: v.optional(v.array(v.id("users"))), // Users who have read this message
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_sender", ["senderId"])
    .index("by_payslip", ["payslipId"]),

  // User chat preferences
  userChatPreferences: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    pinnedConversations: v.array(v.id("conversations")), // Pinned conversation IDs
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_organization", ["userId", "organizationId"]),

  // Invitations
  invitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    invitedBy: v.id("users"),
    employeeId: v.optional(v.id("employees")), // Link to employee if applicable
    inviteeName: v.optional(v.string()), // Name from employee record for pre-filled user on accept
    token: v.string(), // Unique token for invitation acceptance
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
    .index("by_token", ["token"]),

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
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()), // If shared with HR/Admin
    sharedWith: v.optional(v.array(v.id("users"))), // Users who can view this document
    createdAt: v.number(),
    updatedAt: v.number(),
    /** Increments when body content is replaced; first version is 1. Used for version history. */
    contentVersion: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"])
    .index("by_creator", ["createdBy"]),

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
    receipts: v.optional(v.array(v.id("_storage"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
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
});
