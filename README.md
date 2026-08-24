# sweep-external-sdk

TypeScript SDK for the Sweep External API: signed backend client, webhook
verification and browser wallet execution helpers. Zero runtime dependencies.

```bash
npm install sweep-external-sdk
```

Access to the API requires partner registration — see the docs' *Become an
integrator* page for credentials (`SWEEP_API_URL`, `SWEEP_PARTNER_ID`,
`SWEEP_PARTNER_SECRET`).

## Entry points

| Import | Runs on | Contains |
| --- | --- | --- |
| `sweep-external-sdk/server` | Backend only | `SweepExternalClient`, `buildCanonicalSignature`, `verifyWebhook` — everything touching the partner secret |
| `sweep-external-sdk/browser` | Browser | `readWalletCapabilities`, `ensureChain`, `signAuthorization`, `executeChainAction`, `waitForReceipt` over a raw EIP-1193 provider |
| `sweep-external-sdk/shared` | Anywhere | API types, `decimalToRawUnits`, `sumSettledTargetRaw`, status constants |

The partner secret must never enter a browser or mobile bundle; only
`/server` accepts it.

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
  // Ambiguous outcome: retry the SAME body with the SAME key.
}
```

`prepare`, `submitted` and `status` follow the same shape. Every result is a
discriminated union: `reachable: false` means the outcome is ambiguous and the
identical request must be retried with the same idempotency key.

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

## Development

```bash
npm ci
npm test
npm run build
```

## License

MIT
