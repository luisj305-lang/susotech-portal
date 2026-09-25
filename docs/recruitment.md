# Enable recruitment without exposing applicant data

The public form belongs to `susotech.org/empleo`. Active administrators and supervisors review submissions at `portal.susotech.org/postulantes`, using their existing login. No separate recruiter accounts are required.

The earlier `/empleos` form stores records in `job_applications`. These remain separate and readable at `/postulantes/anteriores`; missing consent, license and availability answers are not invented. The new migration also restricts this legacy table to active office readers. The old form/API are preserved, not silently redirected or removed.

## Release sequence

Keep both submission gates off until the database and storage policies have been exercised against a test environment. Code-only checks do not prove deployed RLS behavior.

1. Apply `supabase/migrations/20260915010000_recruitment_applications.sql` to the intended Supabase project after authorization. Verify existing production storage policies have not drifted into permissive cross-bucket access.
2. Configure the portal server with existing Supabase credentials and `RECRUITMENT_RATE_LIMIT_SECRET` (at least 32 random characters, server-only). Do not add a shared `CRON_SECRET` for recruitment: that could activate unrelated scheduled jobs. Set `RECRUITMENT_ENABLED=true` only for the verified deployment. Production rate limiting relies on Vercel's overwritten `X-Forwarded-For` header; off-platform production fails closed.
3. Deploy the portal and verify office access, technician/anonymous denial, private PDF access and opportunistic cleanup. Do not deploy unrelated dirty work without authorization.
4. In the main website project, configure `VITE_RECRUITMENT_ENABLED=true` and rebuild. `VITE_RECRUITMENT_API_URL` is optional; its default is `https://portal.susotech.org/api/public/applications`. Only the main website origins are allowed in production. Never place a service role key or rate-limit secret in a `VITE_*` variable.
5. Publish the main site only after a real test submission with and without a PDF succeeds and becomes visible to both office roles. Confirm the applicant design remains approved. Confirm the privacy notice with the site owner before launch.

## Data flow and limits

- The JSON reservation validates the original fields, consent version, hidden spam field and receipt. A database-backed per-IP HMAC counter allows five reservation attempts per hour, and five finalization attempts per hour, across server instances. This is baseline abuse prevention, not a guarantee against distributed bots.
- A random idempotency key plus a 256-bit in-memory receipt makes network retries safe. Only a SHA-256 receipt hash is stored; neither receipt nor internal review fields are returned in public responses.
- No CV: the reservation is immediately submitted. Optional CV: the browser uploads at most 10 MB directly to a signed, non-overwriting private storage URL, then the portal verifies bytes, size, PDF structure, page limit and active-content restrictions before marking it submitted. This avoids Vercel's function request-body ceiling. Structural checks are not malware scanning.
- Pending reservations are never visible to office users. After validation and rate limiting, each new reservation opportunistically removes at most 50 pending reservations whose expiration is more than 24 hours old, deleting storage objects first. Retries of an existing reservation do not run cleanup; cleanup failure returns 503 before admitting a new row. No unattended cleanup schedule is guaranteed: without new valid reservations, pending data remains until the next admission or a manual cleanup. Monitor the pending backlog. Submitted records are deliberately excluded; retention/deletion policy for completed applications must be agreed separately.
- `GET /api/cron/recruitment-cleanup` is an optional manual endpoint protected by `Authorization: Bearer <CRON_SECRET>` when that secret already exists. It returns 401 when unconfigured. Recruitment adds no Vercel cron or new shared cron secret; unrelated schedules remain unchanged.
- Active office users may update only status and private notes. Optimistic timestamps avoid silently overwriting a colleague's changes. CV links expire after 60 seconds and are generated on demand as downloads.
- Legacy `job_applications` is read-only for office users. Its original migration had no RLS declaration; verify the live policy state and apply the new protection before releasing the historical reader. The original legacy intake endpoint remains a separate flow and does not inherit the new endpoint's rate limiter.

## Verification

```powershell
node --test scripts/verify-recruitment-public.mjs src/lib/recruitment/core.test.mjs src/lib/recruitment/cleanup.test.mjs src/components/recruitment/presentation.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run build
```

The public API tests execute handlers with an in-memory Supabase double. They test validation, origins, body bounds, signed upload/finalization, duplicate retry, rate limiting and PDF checks, but not actual SQL/RLS, Supabase HTTP uploads or browser behavior. Main-site tests are `tests/employment.test.mjs` and `tests/submission.test.mjs` in the separate Vite project.

Before enabling, verify anonymous and technician clients cannot select applications or download CVs; inactive office profiles are denied; admin/supervisor can read submitted applications and update only notes/status; pending credentials cannot be selected; malformed/oversized/interactive PDFs never become submitted; expired receipts cannot finalize; network retries create one row. No real applicant data should be used for tests.

## Disable and rollback

Set `RECRUITMENT_ENABLED=false` on the portal and `VITE_RECRUITMENT_ENABLED=false` in a rebuilt main site to stop public admission. Do not delete collected applications as a code rollback.

This work unit consists of `app/postulantes/`, `app/api/public/applications/`, `app/api/cron/recruitment-cleanup/`, `src/lib/recruitment/`, `src/components/recruitment/`, the recruitment migration/test/docs, and only the additive Postulantes sidebar entry. Preserve unrelated existing sidebar/Vercel changes. The main-site submission helper and functional form changes are independent of its approved aesthetic implementation.
