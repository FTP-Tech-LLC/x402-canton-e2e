# example: express-paid-api

Minimal Express resource server that gates one route behind a Canton
x402 payment via `cantonPaymentMiddleware`.

## Run

The server delegates verification + settlement to a Canton x402
facilitator. For an end-to-end local demo with no real Canton
participant, start the mock facilitator from `examples/mock-facilitator.mjs`:

```bash
# Terminal 1: mock facilitator (always-OK responses)
node ../mock-facilitator.mjs

# Terminal 2: this server
FACILITATOR_URL=http://localhost:4022 pnpm --filter @ftptech/example-express-paid-api start

# Terminal 3: pay for /api/data via the agent-buyer example
RESOURCE_URL=http://localhost:3000/api/data \
  pnpm --filter @ftptech/example-agent-buyer start
```

`GET /api/free` is unprotected. `GET /api/data` requires a x402
payment: the first hit returns 402 with `PAYMENT-REQUIRED`, and a retry with
`PAYMENT-SIGNATURE` succeeds (assuming the facilitator is happy).

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `FACILITATOR_URL` | `http://localhost:4022` | x402 facilitator base URL |
| `PRICE` | `1000000000` | Amount in atomic CC units (10-decimal); 0.1 CC default |
| `MERCHANT_PARTY` | stub | Canton party id receiving payment |
| `FACILITATOR_PARTY` | stub | Facilitator party id (publish what your facilitator advertises in /supported) |
| `SYNCHRONIZER_ID` | stub | Global Synchronizer id |
