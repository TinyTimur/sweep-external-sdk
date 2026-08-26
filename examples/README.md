# Examples

Complete, self-contained examples — every identifier is defined in the file
that uses it. They are excluded from the npm tarball; clone the repo to run
them.

| File | What it is |
| --- | --- |
| [backend.js](./backend.js) | Full integrator backend in one file: quote/prepare/submitted/status endpoints for the frontend, signed-webhook receiver, idempotent-retry wrapper, in-memory store. `node:http` only — zero dependencies |
| [frontend.js](./frontend.js) | Full browser flow as one module: chain metadata, read-only RPC, backend calls, quote → prepare → sign → execute → report evidence → poll. Consumed through any bundler |

## Running the backend

```bash
npm ci && npm run build   # examples import the built package by self-reference
SWEEP_API_URL=https://... \
SWEEP_PARTNER_ID=... \
SWEEP_PARTNER_SECRET=... \
node examples/backend.js
```

It pings Sweep on startup (fails fast on bad credentials or clock skew) and
serves on `http://localhost:8080` (`PORT` to override). Point the webhook
callback URL for your partner at `POST /webhooks/sweep`.

## Running the frontend

`frontend.js` imports the bare specifier `sweep-external-sdk/browser`, so it
goes through your bundler (Vite, webpack, esbuild). Import `runSweep` from
your UI, pass the connected wallet's EIP-1193 provider, the account address
and the `QuoteRequest` your UI assembled, and render progress from the
`onStatus` callback.

## What the examples simplify

Marked inline where they occur:

- persistence is in-memory; production writes durable rows **before** each
  mutating request is transmitted (see
  [Execution rules](https://docs.trysweep.finance/execution))
- the ambiguous-outcome retry runs once, immediately; production schedules
  retries with backoff and resumes them after restarts
- user confirmation between quote and prepare is a comment, not a UI
