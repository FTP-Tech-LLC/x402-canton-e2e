# x402-canton-e2e

End-to-end test of an x402 payment on Canton MainNet against a live facilitator.

The script onboards a self-custody merchant and buyer, provisions the merchant's
`TransferPreapproval`, spawns the bundled `express-paid-api` example (a 402-gated
endpoint using `method=transfer-factory`), and drives one paid request all the
way through settlement.

It uses the published npm packages, so it runs on its own with no monorepo
checkout.

## Prerequisites

- Node 20+
- The **merchant wallet must hold a few CC** before the preapproval step. On the
  self-provider path the merchant pays its own preapproval fee from its own
  wallet, so an empty merchant fails fast with:

  ```
  409 {"error":"merchant_unfunded","party":"<merchant party>", ...}
  ```

  The public faucet is internal-only, so fund the merchant party by transferring
  a couple CC to it from any Canton wallet you control. The script prints the
  merchant party on first run; once it holds CC, accept any pending transfer with
  `canton-agent-wallet claim` before rerunning.

## Run

```bash
npm install
(cd express-paid-api && npm install)

RELAY_URL=https://facilitator.ftptech.xyz node tf-402-e2e.mjs
```

## Environment

All optional; sensible MainNet defaults are baked in.

| Var | Default | Meaning |
| --- | --- | --- |
| `RELAY_URL` | `http://127.0.0.1:4123` | Facilitator relay base URL |
| `NETWORK` | `canton:mainnet` | Payment network |
| `FACILITATOR` | (MainNet facilitator party) | Facilitator party id |
| `SYNC` | (MainNet synchronizer) | Global synchronizer id |
| `DSO` | (MainNet DSO) | DSO party id |
| `AMOUNT` | `0.0100000000` | Payment amount in CC |
| `PORT` | `3011` | Port the example API listens on |
| `MERCHANT_HOME` | `/tmp/tf-402-merchant` | Merchant wallet home dir |
| `BUYER_HOME` | `/tmp/tf-402-buyer` | Buyer wallet home dir |

## What it verifies

A real `transfer-factory` payment settles on-ledger: the buyer pays the merchant
through the facilitator, and the settlement `updateId` resolves on Canton Scan.
