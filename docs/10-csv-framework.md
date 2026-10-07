# 10 — CSV Import Framework

Status: **Approved (Phase 0)** — final decisions applied

One framework, used by every bulk workflow. Nothing from an uploaded file reaches business tables until a user has seen the preview and confirmed.

```
Upload → Parse → Validate → Duplicate Detection → Preview → Confirm → Commit → Result
```

| Step | What happens |
|---|---|
| Upload | `POST /imports/:type` creates an `import_batches` row and returns a presigned S3 PUT URL (max size per type, `.csv` only, UTF-8). The browser uploads directly to S3. |
| Parse | Worker streams the file from S3; header matching is case/space-insensitive with documented aliases; each row stored in `import_rows` (raw + normalised). Formula-injection prefixes (`= + - @`) are neutralised. |
| Validate | Per-type validator (shared zod schema + database lookups). Row status: valid / invalid / warning. |
| Duplicate detection | Within the file **and** against the database (see per-type rules). |
| Preview | Summary: **Total rows, Valid rows, Invalid rows, Duplicates, Warnings, Errors** + paginated row table filterable by status. |
| Error report | `GET /imports/:batchId/error-report` → CSV of the original rows plus `error`/`warning` columns. |
| Confirm | User confirms; option "commit valid rows only" or "nothing unless all valid" (default for allocations). |
| Commit | Single database transaction (or chunked transactions for very large chart imports, each idempotent); re-validated at commit time to catch changes since preview. |
| Result | Final counts, links to created/affected records, audit log entry with batch ID. |

## Per-type rules

### Chart import (Manager, into one project)
Columns: `Chart ID` (required) + optional extra columns kept in `source_data`.
Errors: missing/blank Chart ID, invalid characters/length. Duplicates: same Chart ID twice in file; Chart ID already in this project.

### Login name assignment (Manager)
Columns: `Employee Email`, `Login Name`.
Errors: invalid email format; employee not found; employee inactive; login name blank/invalid.
Duplicates/conflicts: email repeated in file; login name repeated in file; employee already holds a login name; login name already held by someone else (warning offering explicit reassignment only if enabled).

### Chart allocation (Manager)
Columns: `Chart ID`, `Login Name` (+ optional `Project` when the batch is org-wide).
Errors: chart not found in project; chart not in an allocatable status; login name not found / not active; holder inactive; holder not assigned to the project.
Duplicates/conflicts: Chart ID repeated in file; chart already allocated (warning → reallocation requires explicit opt-in).

### Employee import (optional, Manager / Vendor Admin)
Columns: Employee ID, Employee Name, Email, Role, Team. Same rules as manual creation; creates `PENDING_ACTIVATION` employees and queues activation emails only after commit.

## UI

A single `CsvImportWizard` component (stepper: Upload → Review → Confirm → Result) with downloadable templates for each type.
