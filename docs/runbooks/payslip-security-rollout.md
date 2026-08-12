# Payslip Security Rollout

Payslip PINs now use versioned, randomly salted scrypt credentials. The stored
credential is accessible only to internal Convex functions. Verification is
limited to five attempts in a 15-minute window, followed by a 15-minute lock.

Existing SHA-256 PIN rows remain usable during migration. A successful legacy
verification replaces the row with a salted scrypt credential. Newly created or
reset PINs must contain 6 to 12 digits.

## Deployment sequence

1. Deploy the Convex schema and functions before or with the application.
2. Confirm the `payslipPinAttempts` table and indexes are active.
3. Test one existing four-digit PIN. It must verify once and the employee's
   `payslipPinHash` must then start with `scrypt$v1$`.
4. Test setting and resetting a PIN with 6 to 12 digits.
5. Verify that reusing a PIN reset link fails.

## Remove deprecated plaintext PDF passwords

The app no longer reads, writes, returns, or copies custom PDF passwords. PDFs
use the employee's company employee ID as the open password.

For each organization, run the internal Convex function
`payslipSecurityMigrations.clearLegacyPdfPasswords` with `dryRun: true`. Review
the `employeeRows` and `snapshotRows` counts, then run it with `dryRun: false`.
Run the dry-run again and confirm both counts are zero.

The optional schema fields remain for one compatibility release so production
rows can be cleaned before a later contract migration removes the columns.
