# Account, Membership, and Employee Lifecycle Design

## Goal

Separate authentication identity, organization authorization, and employment history so email matching never creates identity links and every offboarding path preserves audit and payroll history.

## Domain model

- `users` is the global login identity. `normalizedEmail` is unique among user accounts, but the stable identity is the user ID.
- `userOrganizations` is the unique `(userId, organizationId)` authorization relationship. It owns `role`, `accessStatus`, and an optional explicit `employeeId` link.
- `employees` is the organization-scoped HR record. The same record is reused on rehire. Names and contact email never identify a user.
- `invitations` is a temporary request containing the intended role and optional employee ID. Acceptance links by IDs, never by employee email discovery.

## Membership lifecycle

- `active`: normal role-based access.
- `suspended`: employment or membership is retained, but organization access is temporarily disabled.
- `alumni`: employment ended with fixed historical self-service access only.
- `removed`: an unlinked non-employee membership ended with no access.

Legacy `disabled` values normalize to `suspended` and are no longer written.

## Employment lifecycle

Canonical employment status is `active` or `separated`. A separated employee has a required category: `resignation`, `termination`, `job_abandonment`, `end_of_contract`, `retirement`, `redundancy`, `mutual_separation`, `death`, `transfer`, or `other`. Legacy `resigned` and `terminated` documents remain readable during migration and normalize to separated categories.

An unexplained absence does not immediately separate the employee. Access may be suspended while attendance and HR investigation continue. Once HR finalizes the departure, it records a separation category, effective date, last working day, reason, and notes.

Archiving is not employment status. Only separated employees may be archived, and their linked membership remains alumni. Rehire reuses the same employee record and explicitly decides whether to restore account access; privileged roles are never silently restored.

## Invitation and linking rules

- A same-email employee or member is a suggestion requiring explicit confirmation.
- Existing employee/account name mismatches are informational and never rewrite either record.
- Active, suspended, alumni, and removed memberships use their dedicated manage/restore/rehire/reinvite flows.
- At most one membership exists per user and organization, and at most one membership links a given employee in an organization.
- Pending employee invitations become ineligible when the employee separates, is archived, or is linked elsewhere.

## Role and access rules

Roles remain on memberships and are independent of employment. Owners may assign all roles; admins may assign HR, manager, accounting, and employee; HR may assign manager and employee. The last active owner cannot be demoted, suspended, removed, or separated.

Alumni access ignores the stored role. Suspended and removed memberships have no organization access.

## Compatibility and integrity

The rollout must read legacy employment and membership states while producing only canonical new states. Convex indexes are not uniqueness constraints, so all create/update/accept mutations must query conflicting index ranges transactionally. Integrity tests and schema inventory are updated with the canonical fields and retained legacy values.
