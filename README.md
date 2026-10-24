# x402-canton-e2e

End-to-end test of an x402 payment in Canton Coin (CC) on Canton MainNet against a live facilitator.

The script creates a self-custody merchant and buyer wallet, creates the merchant's
`TransferPreapproval`, starts the bundled `express-paid-api` example (a 402-gated
endpoint using `method=transfer-factory`) and makes one paid request all the way
through settlement.

It uses the published npm packages (`@ftptech/canton-agent-wallet` 2.4,
`@ftptech/x402-canton-core` 1.4, `@ftptech/x402-canton-express` 0.2.6), so it runs
on its own.

Each run spends real CC: the payment (`AMOUNT`) and, whenever the merchant has no
live preapproval, the fee for a new 2-day one.

## Prerequisites

- Node 22+
- Funded wallets. Both wallets are created on the first run and printed with
  their party ids.
  - A new wallet accepts the relay's starter grant during creation, if the relay
    sends one.
  - The buyer needs at least `AMOUNT` CC.
  - The merchant pays its own preapproval fee, so it needs a few CC. An empty
    merchant gets `409 {"error":"merchant_unfunded",...}` and the script stops.
  - Otherwise send CC to the printed party from any Canton wallet you control and
    rerun. The script accepts pending transfers for both wallets on start.

Each wallet is a key file in its home directory (`.wallets/merchant` and
`.wallets/buyer` by default). Every new home creates a new permanent MainNet
party, so keep these directories. Manual commands for either wallet:

```bash
CANTON_AGENT_HOME=.wallets/buyer npx @ftptech/canton-agent-wallet balance
CANTON_AGENT_HOME=.wallets/buyer npx @ftptech/canton-agent-wallet claim
CANTON_AGENT_HOME=.wallets/buyer npx @ftptech/canton-agent-wallet export
CANTON_AGENT_HOME=.wallets/buyer npx @ftptech/canton-agent-wallet withdraw --to <party>
```

## Run

```bash
npm install
(cd express-paid-api && npm install)

node tf-402-e2e.mjs
```

## Environment

All optional.

| Var | Default | Meaning |
| --- | --- | --- |
| `RELAY_URL` | `https://facilitator.ftptech.xyz` | Facilitator base URL |
| `NETWORK` | `canton:mainnet` | Payment network |
| `FACILITATOR` | first `signers["canton:*"]` from `GET /supported` | Facilitator party (`extra.feePayer`) |
| `SYNC` | `synchronizerId` from `GET /supported` | Global Synchronizer id |
| `DSO` | MainNet DSO party | CC instrument admin |
| `AMOUNT` | `0.0100000000` | Payment amount in CC |
| `PORT` | `3011` | Port the example API listens on |
| `MERCHANT_HOME` | `.wallets/merchant` | Merchant wallet home directory |
| `BUYER_HOME` | `.wallets/buyer` | Buyer wallet home directory |
| `AGENT_KEY` | unset | Sent as `X-Agent-Key`; only for a relay that requires a key |

## What it verifies

- `GET /api/data` answers 402, and the buyer's paid retry returns 200.
- The merchant's CC balance grows by exactly `AMOUNT`.

The settlement `updateId` from the `PAYMENT-RESPONSE` header is printed for lookup
on a Canton explorer.
