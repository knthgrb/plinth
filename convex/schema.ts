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
        })
      )
    ),
    firstPayDate: v.optional(v.number()), // Day of month for first payroll (default: 15)
    secondPayDate: v.optional(v.number()), // Day of month for second payroll (default: 30)
    salaryPaymentFrequency: v.optional(
      v.union(v.literal("monthly"), v.literal("bimonthly"))
    ), // "monthly" = once per month, "bimonthly" = twice per month (e.g. 15th & 30th)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  // Users table (extends Better Auth user)
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")), // Deprecated: kept for backward compatibility
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("owner"),
        v.literal("hr"),
        v.literal("employee"),
        v.literal("accounting")
      )
    ), // Deprecated: kept for backward compatibility
    employeeId: v.optional(v.id("employees")), // Link to employee record if applicable
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
      v.literal("accounting")
    ),
    employeeId: v.optional(v.id("employees")), // If user is also an employee in this org
    joinedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_organization", ["organizationId"])
    .index("by_user_organization", ["userId", "organizationId"]),

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
      dateOfBirth: v.optional(v.number()),
      civilStatus: v.optional(v.string()),
      emergencyContact: v.optional(
        v.object({
          name: v.string(),
          relationship: v.string(),
          phone: v.string(),
        })
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
        v.literal("part-time")
      ),
      hireDate: v.number(),
      regularizationDate: v.optional(v.number()),
      status: v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("resigned"),
        v.literal("terminated")
      ),
    }),
    compensation: v.object({
      basicSalary: v.number(),
      allowance: v.optional(v.number()), // Non-taxable allowance
      salaryType: v.union(
        v.literal("monthly"),
        v.literal("daily"),
        v.literal("hourly")
      ),
      paymentFrequency: v.optional(v.string()), // Deprecated: kept for backward compatibility, will be removed
      bankDetails: v.optional(
        v.object({
          bankName: v.string(),
          accountNumber: v.string(),
          accountName: v.string(),
        })
      ),
      regularHolidayRate: v.optional(v.number()), // Additional % for regular holidays (default 1.0 = 100%)
      specialHolidayRate: v.optional(v.number()), // Additional % for special holidays (default 0.3 = 30%)
      nightDiffPercent: v.optional(v.number()), // Night differential override (default from settings)
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
          })
        )
      ),
    }),
    leaveCredits: v.object({
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
          })
        )
      ),
    }),
    requirements: v.optional(
      v.array(
        v.object({
          type: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("submitted"),
            v.literal("verified")
          ),
          file: v.optional(v.id("_storage")),
          submittedDate: v.optional(v.number()),
          expiryDate: v.optional(v.number()),
          isDefault: v.optional(v.boolean()), // True if from organization defaults
          isCustom: v.optional(v.boolean()), // True if custom requirement for this employee
        })
      )
    ),
    deductions: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.union(
            v.literal("government"),
            v.literal("loan"),
            v.literal("other")
          ),
          name: v.string(),
          amount: v.number(),
          frequency: v.union(v.literal("monthly"), v.literal("per-cutoff")),
          startDate: v.number(),
          endDate: v.optional(v.number()),
          isActive: v.boolean(),
        })
      )
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
            v.literal("per-cutoff")
          ),
          isActive: v.boolean(),
        })
      )
    ),
    customFields: v.optional(v.any()), // Flexible object for custom fields
    /** Hashed PIN for accessing payslips page (e.g. SHA-256 of pin + salt). Set by employee or HR. */
    payslipPinHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee_id", ["employment.employeeId"])
    .index("by_status", ["employment.status"])
    .index("by_department", ["employment.department"]),

  // Attendance table
  attendance: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.number(), // Unix timestamp
    scheduleIn: v.string(), // Time string "HH:mm"
    scheduleOut: v.string(),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()), // Hours
    late: v.optional(v.number()), // Minutes late
    undertime: v.optional(v.number()), // Hours undertime
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working")
      )
    ),
    remarks: v.optional(v.string()),
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half-day"),
      v.literal("leave")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_date", ["date"])
    .index("by_organization", ["organizationId"])
    .index("by_employee_date", ["employeeId", "date"]),

  // Holidays table
  holidays: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    date: v.number(), // Unix timestamp
    type: v.union(
      v.literal("regular"),
      v.literal("special"), // Special non-working holiday (has premium rate)
      v.literal("special_working") // Special working holiday (no additional rate)
    ),
    isRecurring: v.boolean(),
    year: v.optional(v.number()), // For non-recurring holidays
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
    period: v.string(), // "2025-01-01 to 2025-01-15"
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("finalized"),
      v.literal("paid"),
      v.literal("archived"),
      v.literal("cancelled")
    ),
    processedBy: v.id("users"),
    processedAt: v.optional(v.number()),
    /** Set when run is saved as draft; indicates gov/attendance deductions were applied in payslips */
    deductionsEnabled: v.optional(v.boolean()),
    notes: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          date: v.number(),
          note: v.string(),
          addedBy: v.id("users"),
          addedAt: v.number(),
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_period", ["cutoffStart", "cutoffEnd"]),

  // Payslips table
  payslips: defineTable({
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    payrollRunId: v.id("payrollRuns"),
    period: v.string(),
    grossPay: v.number(),
    deductions: v.array(
      v.object({
        name: v.string(),
        amount: v.number(),
        type: v.string(),
      })
    ),
    incentives: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.number(),
          type: v.string(),
        })
      )
    ),
    nonTaxableAllowance: v.optional(v.number()),
    netPay: v.number(),
    daysWorked: v.number(),
    absences: v.number(),
    lateHours: v.number(),
    undertimeHours: v.number(),
    overtimeHours: v.number(),
    holidayPay: v.optional(v.number()),
    restDayPay: v.optional(v.number()),
    nightDiffPay: v.optional(v.number()),
    overtimeRegular: v.optional(v.number()),
    overtimeRestDay: v.optional(v.number()),
    overtimeRestDayExcess: v.optional(v.number()),
    overtimeSpecialHoliday: v.optional(v.number()),
    overtimeSpecialHolidayExcess: v.optional(v.number()),
    overtimeLegalHoliday: v.optional(v.number()),
    overtimeLegalHolidayExcess: v.optional(v.number()),
    pendingDeductions: v.optional(v.number()),
    hasWorkedAtLeastOneDay: v.optional(v.boolean()),
    /** Employer share of gov contributions (per cutoff) for accounting total. */
    employerContributions: v.optional(
      v.object({
        sss: v.optional(v.number()),
        philhealth: v.optional(v.number()),
        pagibig: v.optional(v.number()),
      })
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
            })
          ),
        })
      )
    ),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_payroll_run", ["payrollRunId"])
    .index("by_organization", ["organizationId"])
    .index("by_period", ["period"]),

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
      v.literal("custom")
    ),
    customLeaveType: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    numberOfDays: v.number(),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled")
    ),
    supportingDocuments: v.optional(v.array(v.id("_storage"))),
    filedDate: v.number(),
    reviewedBy: v.optional(v.id("users")),
    reviewedDate: v.optional(v.number()),
    remarks: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_status", ["status"])
    .index("by_organization", ["organizationId"])
    .index("by_date_range", ["startDate", "endDate"]),

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
      })
    ),
    status: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("on-hold")
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
      v.literal("rejected")
    ),
    appliedDate: v.number(),
    notes: v.optional(
      v.array(
        v.object({
          date: v.number(),
          author: v.id("users"),
          content: v.string(),
        })
      )
    ),
    interviewSchedules: v.optional(
      v.array(
        v.object({
          date: v.number(),
          type: v.string(),
          interviewer: v.id("users"),
          remarks: v.optional(v.string()),
        })
      )
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
      v.literal("company-policies")
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other")
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent")
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
        v.literal("company-policies")
      )
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other")
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent")
    ),
    author: v.id("users"),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees")
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    publishedDate: v.number(),
    expiryDate: v.optional(v.number()),
    reactions: v.optional(v.array(v.any())),
    attachments: v.optional(v.array(v.id("_storage"))),
    isPublished: v.boolean(),
    acknowledgementRequired: v.boolean(),
    acknowledgedBy: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          date: v.number(),
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_published", ["isPublished"])
    .index("by_date", ["publishedDate"]),

  // Settings table (organization-specific configurations)
  settings: defineTable({
    organizationId: v.id("organizations"),
    cutoffDates: v.optional(
      v.object({
        firstCutoff: v.number(), // Day of month (1-15)
        secondCutoff: v.number(), // Day of month (16-31)
      })
    ),
    payrollFrequency: v.optional(
      v.union(
        v.literal("weekly"),
        v.literal("semi-monthly"),
        v.literal("monthly")
      )
    ),
    taxTable: v.optional(v.string()), // Reference to tax table version
    // Payroll configurations
    payrollSettings: v.optional(
      v.object({
        nightDiffPercent: v.optional(v.number()), // Night differential: additional % per hour from 10 PM (default 0.1 = 10%)
        regularHolidayRate: v.optional(v.number()), // Regular holiday day premium: additional % of daily pay (default 1.0 = 100%)
        specialHolidayRate: v.optional(v.number()), // Special holiday day premium: additional % of daily pay (default 0.3 = 30%)
        overtimeRegularRate: v.optional(v.number()), // Regular day OT multiplier (default 1.25 = 125% per hour)
        overtimeRestDayRate: v.optional(v.number()), // Rest day OT multiplier (default 1.69 = 169%)
        regularHolidayOtRate: v.optional(v.number()), // Regular holiday OT multiplier (default 2.0 = 200%)
        specialHolidayOtRate: v.optional(v.number()), // Special holiday OT multiplier (default 1.69 = 169%)
        // Daily rate from monthly: (basic + allowance?) × (12 / workingDaysPerYear)
        dailyRateIncludesAllowance: v.optional(v.boolean()), // If true, daily rate = (basic + allowance) × 12/261 (default false = basic only)
        dailyRateWorkingDaysPerYear: v.optional(v.number()), // Working days per year for daily rate (default 261)
      })
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
        })
      )
    ),
    // Prorated leave: when true, annual leave is prorated by months worked (e.g. new hires get (annual/12)*months)
    proratedLeave: v.optional(v.boolean()),
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
          })
        )
      )
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
            v.literal("rating")
          ),
          hidden: v.optional(v.boolean()),
          hasRatingColumn: v.optional(v.boolean()),
          hasNotesColumn: v.optional(v.boolean()),
        })
      )
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
            v.literal("link")
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
        })
      )
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
            v.literal("link")
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
        })
      )
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
            v.literal("link")
          ),
          sortable: v.optional(v.boolean()),
          width: v.optional(v.string()),
          customField: v.optional(v.boolean()),
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  // Chat conversations
  conversations: defineTable({
    organizationId: v.id("organizations"),
    participants: v.array(v.id("users")), // Users in the conversation
    type: v.union(v.literal("direct"), v.literal("group")),
    name: v.optional(v.string()), // For group chats
    createdBy: v.optional(v.id("users")), // User who created the group chat
    lastMessageAt: v.optional(v.number()),
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
      v.literal("system")
    ),
    attachments: v.optional(v.array(v.id("_storage"))),
    payslipId: v.optional(v.id("payslips")), // Link message to payslip for appeals/comments
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
      v.literal("accounting")
    ),
    invitedBy: v.id("users"),
    employeeId: v.optional(v.id("employees")), // Link to employee if applicable
    token: v.string(), // Unique token for invitation acceptance
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("cancelled")
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
      v.literal("other")
    ),
    category: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()), // If shared with HR/Admin
    sharedWith: v.optional(v.array(v.id("users"))), // Users who can view this document
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_employee", ["employeeId"])
    .index("by_creator", ["createdBy"]),

  // Accounting cost items (categoryName: "Employee Related Cost" | "Operational Cost")
  accountingCostItems: defineTable({
    organizationId: v.id("organizations"),
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
      v.literal("yearly")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("partial"),
      v.literal("paid"),
      v.literal("overdue")
    ),
    dueDate: v.optional(v.number()), // Timestamp
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
        v.literal("maintenance")
      )
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),
});
