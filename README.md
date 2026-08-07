# Google Sheets to Smartsheet Transfer

Transfer data from Google Sheets to Smartsheet with image preservation.

## Setup

1. `npm install && cd client && npm install`
2. Copy `.env.example` to `.env` and fill in the values below
3. `npm run dev`

The schema creates itself on boot, so an empty database is all that is needed.

## Environment Variables

- `DATABASE_URL` — Postgres connection string. Use a pooled connection string if your provider offers one, or a long-running server will exhaust the direct connection limit.
- `DATABASE_POOL_SIZE` — Maximum application connections. Start with `5` on a small Render instance and Neon Free project.
- `STALE_TRANSFER_MINUTES` — How long a running job may go without a database heartbeat before it is marked failed after an instance interruption. Defaults to `15`.
- `TRANSFER_HISTORY_RETENTION_DAYS` — Completed-job retention. `0` keeps the audit history indefinitely; set a positive number only when automatic deletion is intended.
- `TRUST_PROXY` — Number of reverse proxies in front of the app, or `loopback` when there are none. Never set it above the real hop count: each extra hop lets a client forge an `X-Forwarded-For` entry.
- `SESSION_SECRET` — Signing key for session cookies. Minimum 32 characters.
- `ENCRYPTION_KEY` — AES-256 key encrypting stored OAuth tokens. Minimum 32 characters, and changing it invalidates every stored token.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials with the Sheets and Drive read scopes enabled.
- `SMARTSHEET_CLIENT_ID` / `SMARTSHEET_CLIENT_SECRET` — Smartsheet OAuth credentials.
- `BASE_URL` — Public URL of this server. OAuth redirect URIs are derived from it, so it must match what is registered with Google and Smartsheet.
- `CLIENT_URL` — Public URL of the frontend. Used for CORS and WebSocket origin checks.

## Deployment

- Run as a single always-on instance. The outbound rate limiter, Socket.IO room state, and progress coalescing are all per-process, so a second instance would double the request rate at Smartsheet.
- Do not deploy where idle instances sleep or request duration is capped. Transfers continue in the background after the HTTP response is sent, so either one kills the job mid-flight.
- An interrupted transfer is deliberately marked failed instead of resumed automatically. Smartsheet row insertion is not idempotent, so blind retry could duplicate rows. True restart-safe resume requires a durable queue plus an idempotency/checkpoint design.
