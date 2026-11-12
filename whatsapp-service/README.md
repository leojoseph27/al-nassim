# WhatsApp Order Notification Service

A minimal, standalone service for sending **one-to-one transactional order
notifications** over WhatsApp, built on the community-maintained
[Baileys](https://github.com/WhiskeySockets/Baileys) library (used as an npm
dependency — no WhatsApp client code is copied or reimplemented).

It is intentionally **not** a WhatsApp management app: no bulk messaging, no
contact scraping, no marketing automation. One customer, one message, per API
call.

## Requirements

- Node.js **>= 20** (Baileys 7 requirement)
- A WhatsApp account on your phone (to scan the QR once)

## Setup (Windows / Linux)

```bash
cd whatsapp-service
npm install
copy .env.example .env      # Windows  (on Linux: cp .env.example .env)
# edit .env and set API_KEY to a long random secret
npm run dev                 # build + start (one command)
```

On first start the service connects to WhatsApp and waits for a login.

## QR login (first time only)

1. Open the app in a terminal — the log prints `state: awaiting_qr`.
2. Get the QR in a browser: `http://127.0.0.1:3000/qr`
   with header `Authorization: Bearer <your API_KEY>` (it renders as a data
   URL; you may open the URL in a tool that decodes the image), or view
   `/qr`'s `qrDataUrl` directly.
3. In WhatsApp on your phone: **Settings → Linked devices → Link a device**,
   then scan.
4. The session is stored in `auth/`. After this, restarts **do not** require
   a new QR scan (`/status` will show `"state": "open"`).

The QR rotates roughly every 20 seconds — just refetch `/qr` if it expires.
If the session is ever invalidated remotely (WhatsApp "logged out" the
linked device), the stored session is cleared automatically and a fresh QR
is required.

## API

| Method | Path            | Auth      | Purpose                                  |
|--------|-----------------|-----------|------------------------------------------|
| GET    | `/health`       | none      | Liveness probe (process up).             |
| GET    | `/status`       | none      | WhatsApp connection state (no secrets).  |
| GET    | `/qr`           | API key   | Current login QR as a PNG data URL.      |
| POST   | `/send-message` | API key   | Send one text message to one customer.   |

Authentication: header `Authorization: Bearer <API_KEY>` (or `X-API-Key`).

### POST /send-message

```json
{
  "phone": "+9665xxxxxxxx",
  "message": "Order #1234 confirmed. Track it here: https://…",
  "idempotencyKey": "order-1234"
}
```

- `phone` — international format, 8–15 digits, optional leading `+`.
- `message` — plain text, max 4096 chars.
- `idempotencyKey` — **strongly recommended** (e.g. `order-1234`). The same
  key within 24 h never sends twice; replays return the original outcome.

Responses:

- `200 {"ok":true,"delivered":true,"messageId":"…","maskedPhone":"966****123"}`
- `200 {"ok":false,"delivered":false,…}` when WhatsApp accepted the request
  but the send failed.
- `200 {"ok":true,"idempotentReplay":true,…}` — duplicate suppressed.
- `401` — missing/wrong API key.
- `400` — `INVALID_PHONE` or `INVALID_MESSAGE`.
- `503` — `NOT_CONNECTED` (WhatsApp not connected; the key is *not* consumed,
  so the order API can retry safely).

Example:

```bash
curl -X POST http://127.0.0.1:3000/send-message \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+9665xxxxxxxx","message":"Order #1234 confirmed","idempotencyKey":"order-1234"}'
```

## Security

- `auth/` (session credentials) and `.env` are git-ignored; the session is
  the equivalent of a logged-in WhatsApp device — treat it like a password.
- `/qr` and `/send-message` require the API key.
- Phone numbers are masked in responses; no message bodies are logged.
- Idempotency keys prevent duplicate order notifications.
- Bound to `127.0.0.1` by default; do not expose directly to the internet.

## Moving to a Linux VPS later

1. Copy the project folder **including `auth/` and `.env`** over an encrypted
   channel (e.g. `scp`), or better: run `npm install` on the VPS and copy
   only `auth/` + `.env`.
2. Set `HOST=0.0.0.0` behind a reverse proxy with TLS (nginx/Caddy) and keep
   the API key requirement.
3. `npm run build && npm start` (use `pm2` or a systemd unit to keep it alive).

## Architecture

```
src/
  config.ts    env-driven configuration
  auth.ts      session storage on top of Baileys useMultiFileAuthState
  whatsapp.ts  single-socket connection manager: QR, reconnect, status
  sender.ts    phone validation, idempotency, one-to-one text sending
  server.ts    Express HTTP API
```

Dependency: `baileys@7.0.0-rc14` (MIT). Baileys' MIT licence notice is
preserved in `LICENSE`.

## Local testing interface (dev only)

Open **http://127.0.0.1:3000/test** in a browser while the service runs.
It shows the live connection state, the login QR (auto-refreshing), and a
"SEND WHATSAPP" button that **schedules** the test message `hello how are you`
to the entered number after a 30-second countdown. The send happens
server-side through the same single Baileys connection and `sendOrderMessage`
path — the API key is never exposed to the browser. Only one test can be
pending at a time; duplicate clicks are rejected.

## Known limitations

- Baileys is an unofficial library; WhatsApp may change its protocol at any
  time and could in principle restrict accounts using unofficial clients.
  Use a dedicated number for this service.
- Idempotency store is in-memory: keys are lost on restart (send retries from
  the Next.js side should still be safe since the key is reserved before
  sending; for cross-restart deduplication, persist keys in a database later).
- One WhatsApp session/number per service instance.
- The message text is provided by the caller — the Next.js API composes the
  order-confirmation text (order number + order-sheet URL).
