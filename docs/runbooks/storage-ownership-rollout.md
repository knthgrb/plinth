# Storage Ownership Rollout

New uploads are registered in `storageObjects` through a short-lived upload
intent. Existing production files remain readable only when a record in the
requested organization references the storage ID.

## Deployment sequence

1. Deploy the Convex schema and application together.
2. In the Convex dashboard, open the internal function
   `storageMigrations.backfillAuthoredStorageObjects`.
3. Run it for each organization with `dryRun: true` and record the
   `discovered`, `existing`, and `unresolved` counts.
4. Resolve unexpected cross-organization or missing-owner results before
   running with `dryRun: false`.
5. Run it again with `dryRun: false`. It is idempotent and does not delete or
   modify the source documents.
6. Repeat the dry run and confirm all attributable document and announcement
   attachments are reported as existing.

The initial backfill deliberately does not invent ownership for accounting
receipts that lack an attributable creator. Employee requirements, leave
evidence, applicant resumes, payslip files, and historical chat attachments
continue through the organization-reference compatibility resolver until their
resource-specific migration is added. Do not remove that resolver until every
resource class has zero unresolved rows.
