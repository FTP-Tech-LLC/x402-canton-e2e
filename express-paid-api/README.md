# example: express-paid-api

Minimal Express resource server that gates one route behind a Canton
x402 payment via `cantonPaymentMiddleware`.

`GET /api/free` is unprotected. `GET /api/data` requires an x402 payment: the
first request returns 402 with `PAYMENT-REQUIRED`, and a retry with
`PAYMENT-SIGNATURE` returns 200 once the facilitator verifies and settles it.

## Run

The merchant party must hold a live `TransferPreapproval`
(`canton-agent-wallet preapproval`). Take the facilitator party from
`signers["canton:*"]` and the synchronizer id from `kinds[].extra.synchronizerId`
in `GET https://facilitator.ftptech.xyz/supported`.

```bash
npm install

FACILITATOR_URL=https://facilitator.ftptech.xyz \
CANTON_X402_PAYTO=<merchant party> \
CANTON_X402_FACILITATOR=<feePayer from /supported> \
CANTON_SYNCHRONIZER_ID=<synchronizerId from /supported> \
CANTON_X402_DSO=DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc \
npm start
```

Pay from a funded wallet:

```bash
npx @ftptech/canton-agent-wallet pay --relay-url https://facilitator.ftptech.xyz http://127.0.0.1:3000/api/data
```

`npm start` runs Node with `--max-http-header-size=32768`. A `PAYMENT-SIGNATURE`
header is about 8 to 10 KiB, and servers must accept at least 16 KiB.

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NETWORK` | `canton:mainnet` | CAIP-2 network |
| `FACILITATOR_URL` | `http://127.0.0.1:4123` | Facilitator base URL |
| `X402_AMOUNT` | `500000000` | Price in atomic CC units (1 CC = 10^10); 0.05 CC |
| `CANTON_X402_PAYTO` | placeholder | Merchant party receiving the payment |
| `CANTON_X402_FACILITATOR` | placeholder | Facilitator party (`extra.feePayer`), as advertised in `/supported` |
| `CANTON_SYNCHRONIZER_ID` | placeholder | Global Synchronizer id |
| `CANTON_X402_DSO` | placeholder | DSO party; sets `asset` and `extra.instrumentId`. Required for a real payment |
| `EXECUTE_BEFORE_SECONDS` | `120` | `extra.executeBeforeSeconds` |
