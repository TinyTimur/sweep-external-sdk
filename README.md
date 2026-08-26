# sweep-external-sdk

TypeScript SDK for the
[Sweep External API](https://docs.trysweep.finance): signed backend client,
webhook verification and browser wallet execution helpers. Zero runtime
dependencies.

```bash
npm install sweep-external-sdk
```

Access to the API requires partner registration — see
[Become an integrator](https://docs.trysweep.finance/become-an-integrator) for
credentials (`SWEEP_API_URL`, `SWEEP_PARTNER_ID`, `SWEEP_PARTNER_SECRET`).

## Entry points

| Import | Runs on | Contains |
| --- | --- | --- |
| `sweep-external-sdk/server` | Backend only | `SweepExternalClient`, `buildCanonicalSignature`, `verifyWebhook` — everything touching the partner secret |
| `sweep-external-sdk/browser` | Browser | `readWalletCapabilities`, `ensureChain`, `signAuthorization`, `executeChainAction`, `waitForReceipt` over a raw EIP-1193 provider |
| `sweep-external-sdk/shared` | Anywhere | API types, `decimalToRawUnits`, `sumSettledTargetRaw`, status constants |

The partner secret must never enter a browser or mobile bundle; only
`/server` accepts it.

There is deliberately no root import — `import ... from 'sweep-external-sdk'`
fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Always pick the entry point for
the environment the code runs in: the split exists so that secret-touching
server code cannot end up in a browser bundle by accident.

TypeScript must use `moduleResolution: "bundler"`, `"node16"` or
`"nodenext"` — the legacy `"node"` (node10) mode cannot resolve subpath
exports, so imports and their types will not be found.

The snippets below are sketches, not runnable programs: `provider`
(an EIP-1193 provider), `address`, `quoteRequest`, `prepared`
(a `PrepareResponse`), `CHAINS`, `rpc`, `store`, `persistAndReport` and
`onAttemptEvent` stand for objects your application supplies.

## Backend

```ts
import crypto from 'node:crypto'
import { SweepExternalClient } from 'sweep-external-sdk/server'

const client = new SweepExternalClient({
  sweepApiUrl: process.env.SWEEP_API_URL!,
  partnerId: process.env.SWEEP_PARTNER_ID!,
  secret: process.env.SWEEP_PARTNER_SECRET!,
})

// Verify credentials and signature implementation:
const ping = await client.ping()

// Quote (persist the idempotency key and body BEFORE transmission):
const key = `quote-${crypto.randomUUID()}`
const result = await client.quote(quoteRequest, key)

if (!result.reachable) {
  // Timeout or network failure — the outcome is UNKNOWN:
  // retry the SAME body with the SAME idempotency key.
} else if (!result.ok) {
  // Sweep answered with an error. result.response is a SweepErrorBody:
  // `error` is the stable failure family, `code` the stable detail,
  // `message` (when present) is safe to render.
  //   401/400 → fix the request or signing; do not blind-retry
  //   429     → back off per the RateLimit-* headers
  //   5xx     → retry the SAME body with the SAME key
  // Full code tables: https://docs.trysweep.finance/errors
} else {
  // Typed success body:
  const quote = result.response // QuoteResponse
}
```

`prepare`, `submitted` and `status` follow the same shape. Every result is a
discriminated union: `reachable: false` means the outcome is ambiguous and the
identical request must be retried with the same idempotency key; `reachable:
true, ok: false` means Sweep definitively rejected the request — the common
case in production, handled per the tables at
[docs.trysweep.finance/errors](https://docs.trysweep.finance/errors).

Each HTTP result also carries `debug.signingString` — the canonical string
that was signed, for comparing against the envelope in the
[authentication docs](https://docs.trysweep.finance/authentication) when
debugging 401s. It contains no secret, but it does expose your partner id,
nonces and request paths — don't dump whole result objects into long-lived
logs; log identifiers you chose deliberately.

## Webhooks

```ts
import { verifyWebhook } from 'sweep-external-sdk/server'

app.post('/webhooks/sweep', express.raw({ type: '*/*' }), async (req, res) => {
  const result = verifyWebhook(
    { partnerId: process.env.SWEEP_PARTNER_ID!, secret: process.env.SWEEP_PARTNER_SECRET! },
    { rawBody: req.body, headers: req.headers },
  )
  if (!result.ok) return res.status(result.status).json({ error: result.error })
  const isNew = await store.recordEventOnce(result.payload.eventId, result.payload)
  if (isNew) await onAttemptEvent(result.payload)
  return res.status(200).end()
})
```

## Browser

```ts
import {
  readWalletCapabilities,
  ensureChain,
  signAuthorization,
  executeChainAction,
  waitForReceipt,
} from 'sweep-external-sdk/browser'

const walletCapabilities = await readWalletCapabilities(provider, address)
// ... backend calls prepare with walletContext.walletCapabilities ...

const { signature } = await signAuthorization(provider, address, prepared.walletAuthorization)

for (const action of prepared.chainActions) {
  await ensureChain(provider, action.chainId, CHAINS)
  const evidence = await executeChainAction(provider, address, action, {
    waitForReceipt: (chainId, hash) => waitForReceipt(rpc, chainId, hash),
    onEvidence: (e) => persistAndReport(action.chainId, e), // report as soon as it exists
  })
}
```

## Settled amounts

```ts
import { decimalToRawUnits, sumSettledTargetRaw } from 'sweep-external-sdk/shared'

// settledOutputs[].amount is a padded decimal string — never parseUnits() it directly.
const totalRaw = sumSettledTargetRaw(status.settledOutputs, {
  chainId: 42161,
  symbol: 'USDC',
  decimals: 6,
})
```

Auto-spend the total only when every included output has `amountBasis:
"actual"`; resolve and confirm `estimated` amounts against the recipient's
balance.

## Documentation

Full API reference, request/response examples, error and retry semantics:
[docs.trysweep.finance](https://docs.trysweep.finance).

## Development

```bash
npm ci
npm test
npm run build
```

## License

MIT
