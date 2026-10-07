# 06 — Authentication Architecture

Status: **Approved (Phase 0)** — final decisions applied

**Email + password** only. No login-name login, phone login, Firebase Auth or social login.

## 1. Components

| Piece | Design |
|---|---|
| Password hashing | **Argon2id** (memory-hard; parameters tuned to ~250 ms on the API task size). Stored in `credentials`, never in `employees`. |
| Password policy | Min 12 characters; rejects passwords containing the email/name; strength check (zxcvbn score ≥ 3); optional breached-password check (k-anonymity) — D-17. |
| Access token | JWT, **15 min**, signed **ES256** with key ID (`kid`) for rotation. Claims: `sub`, `role`, `vid` (vendor), `sid` (session), `pv` (permissions version). |
| Refresh token | Opaque 256-bit random, **SHA-256 hashed** in `sessions`; rotated on every refresh; **reuse detection** revokes the whole token family. Idle timeout 12 h, absolute 7 days (configurable). |
| Browser storage | `httpOnly; Secure; SameSite=Lax` cookies on the shared parent domain: `sc_at` (access), `sc_rt` (refresh, `Path=/api/v1/auth`). No tokens in `localStorage`. |
| CSRF | SameSite=Lax + double-submit token (`sc_csrf` readable cookie echoed in `X-CSRF-Token`) + `Origin` allow-list check. |
| Immediate revocation | Each request checks the session's `revoked_at` and the employee's status via a Redis cache (≤ 30 s TTL), so deactivation/reset takes effect within seconds, not at token expiry. |
| Brute force | Rate limits per IP and per email; 5 failed attempts → 15 min lock (`LOCKED` + `locked_until`); generic error messages. |
| Mobile (V2) | Same endpoints in bearer mode; refresh token kept in secure device storage. |

This requires the web app and API to share a registrable domain (e.g. `app.example.com` + `api.example.com`) — see D-06.

## 2. Activation & reset tokens

- 32 random bytes (base64url) → sent only by email in a link (`https://app.<domain>/activate?token=…`).
- Database stores **SHA-256(token)** only, with `type`, `expires_at`, `used_at`, `revoked_at`.
- **Single use**: consumed in the same transaction that sets the password (`UPDATE … WHERE used_at IS NULL AND expires_at > now()` — race-safe).
- **Expiry**: activation 72 h, reset 30 min (settings).
- Issuing a new token revokes any previous live token of the same type.
- Successful activation/reset revokes all sessions and invalidates all other tokens of that employee.
- Responses never reveal whether an email exists (`/password/forgot` always `202`).
- Token values never appear in logs, API responses, the Manager UI or the audit log.

## 3. Flows

### Login
```mermaid
sequenceDiagram
  participant U as Browser
  participant W as Next.js (Vercel)
  participant A as API (NestJS)
  participant D as PostgreSQL
  U->>W: /login (email, password)
  W->>A: POST /auth/login
  A->>A: rate limit (IP + email)
  A->>D: employee by email + credential
  alt PENDING_ACTIVATION
    A-->>W: 403 ACCOUNT_NOT_ACTIVATED
  else INACTIVE / LOCKED
    A-->>W: 403 ACCOUNT_UNAVAILABLE
  else password ok
    A->>D: create session (hashed refresh token)
    A->>D: audit_log LOGIN_SUCCEEDED
    A-->>U: Set-Cookie sc_at, sc_rt, sc_csrf
    W->>U: redirect to role home
  end
```

### Employee creation → activation
```mermaid
sequenceDiagram
  participant M as Manager / Vendor Admin
  participant A as API
  participant D as PostgreSQL
  participant Q as Worker + SES
  participant E as Employee
  M->>A: POST /employees {employeeId, name, email, role, team?}
  A->>D: employee (PENDING_ACTIVATION), auth_token (hash), outbox email — one transaction
  Q->>E: Activation email (SmartCode branded)
  E->>A: GET /auth/activation/:token (validate)
  E->>A: POST /auth/activation {token, password}
  A->>D: credential (argon2id), token used_at, status ACTIVE, activated_at
  A-->>E: redirect to login
```

### Forgot password / Manager-triggered reset
Either the employee (`/password/forgot`) or a Manager/Vendor Admin (`POST /employees/:id/password-reset`) creates a reset token. The link is emailed **to the employee only**. On reset, all sessions are revoked and the event is audit-logged (who triggered it, never the password).

## 4. Bootstrap of the first Manager (no hard-coded passwords)

```
BOOTSTRAP_MANAGER_EMAIL=… BOOTSTRAP_MANAGER_NAME=… BOOTSTRAP_MANAGER_EMPLOYEE_ID=… pnpm bootstrap:manager
```

- Runs as a one-off ECS task (or locally against dev).
- Refuses to run if any active Manager already exists (idempotent, safe to re-run).
- Creates the Manager as `PENDING_ACTIVATION` and emails an activation link — **no password exists anywhere** until the Manager sets one in the browser.
- Writes `audit_log` `BOOTSTRAP_MANAGER_CREATED` (actor: system).
- For local development only, `--print-link` prints the link to the terminal; it is refused when `APP_ENV` is `staging` or `production`.

## 5. Authorization hand-off

After authentication, every request passes the permission guard and scope layer described in `03-rbac-matrix.md`. The frontend uses `GET /auth/me` permissions only to show/hide UI; the API re-checks everything.
