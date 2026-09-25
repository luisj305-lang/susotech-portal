# Manual jobs: prospective financial weeks

Administrators and supervisors can register manual jobs with a description, work
date and financial week. New technician submissions use their registration week.
Approval still controls eligibility for earnings, but no longer moves new manual
work into a later financial week. Existing manual rows retain approval-date
attribution; existing regular delivery submission/resubmission rules are unchanged.

## Quick path

1. Open **Trabajo manual** as an administrator or supervisor.
2. Enter PRISM, amount, description, actual work date and the Friday that starts
   the desired financial week. The work date describes the work, not the cutoff.
3. Select active technicians and distribute exactly 100%. Submit for review.
4. Approve through the existing review flow. A Thursday submission approved on
   Saturday remains in its submission/selected week, once approved.
5. For a new record, use **Editar trabajo** to correct its data or split, including
   after approval. Save with the loaded revision; a conflicting edit requires
   reloading the record rather than silently overwriting another correction.

## Approved corrections and receipts

Corrections are one database transaction: header, worker split, incremented
revision, receipt invalidation and before/after audit succeed or roll back
together. Approval status, reviewer, approval timestamp and registration timestamp
are preserved. Repeated approval requests for a new approved record are no-ops.
The audit table is readable by office viewers, including auditors, not workers;
ordinary authenticated clients cannot insert, update or delete audit events.

The initial PDF uses a revision-specific storage key and a conditional attachment
RPC. If an edit wins the race, the initial upload cannot reattach its old receipt.
After editing, the previous pointer is cleared and the UI explicitly says the PDF
is unavailable. There is no new regeneration workflow in this feature. Old storage
objects are not deleted. Already-issued links can remain usable until their
existing 60-second expiry; they are not advertised as the corrected receipt.

## Preservation and dates

| Record / view | Date source |
|---|---|
| Legacy manual financial reports | Original New York approval date |
| New manual financial reports | Stored financial Friday (Friday–Thursday period) |
| Regular financial reports | Existing current delivery submission timestamp |
| Manual operational lists | Registration timestamp, unchanged |
| Regular operational lists | Assignment timestamp, unchanged |

The migration records activation once using the database clock and
`America/New_York`. Office selections cannot precede that activation Friday.
This protects periods before activation without adding a paid/closed ledger.
Work dates may describe earlier work, but cannot be in the future. Legacy rows
receive no backfill and cannot use the new editor. A later approval of an existing
legacy pending job still follows its original behavior.

Participant reads retain their existing privacy: a creator sees the full split;
a participating non-creator sees only their own worker row. Auditors can read
office lists and financial reports but cannot create, review or edit.

## Deployment and rollback caution

- **Migrations are NOT APPLIED to any remote database by this work.** Local
  PGlite tests use disposable fixtures, never customer data.
- Apply additive migrations `20260922010000_manual_office_week_cutoff.sql` then
  `20260922020000_manual_office_edits.sql` only
  through a separately authorized deployment. Its prerequisite participant and
  auditor migrations are currently part of pre-existing uncommitted work.
- Deploy the compatible application after the migrations. Versioned list/earnings
  RPCs expose the new metadata; legacy signatures remain available. Older client
  earnings views lack the new financial-date display and are not a complete UI
  rollback strategy once prospective records exist.
- To roll back, disable new entry points and preserve columns, activation state,
  records and audit. Do not restore approval-only report definitions after new
  records exist: that would move money between weeks. Financial reversals require
  explicit authorization.
- No live browser, mobile/accessibility, storage, production or deployment pass
  is implied. Follow the exact local evidence in
  [the task record](../odd/tasks/manual-office-week-cutoff.md).

## Known separate limitations

The office UI has a pre-existing duplicate-worker-row Map overwrite when regular
and manual financial aggregates coexist. SQL continues returning those separate
rows; this feature does not change that unrelated aggregation policy. Manual
rounded participant shares also retain their existing rounding behavior.
The local UI test executes `getWorkerOperationsDashboard` from
`src/lib/jobs/queries.ts:196-211` and reproduces 12,000 displayed cents for
10,000 regular + 12,000 manual cents, instead of their 22,000 sum. SQL reports,
technician earnings and the CSV use the new financial week; full office UI total
agreement is therefore a known separate limitation, not a claimed success.
