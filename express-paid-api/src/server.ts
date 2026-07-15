/**
 * Example resource server that gates GET /api/data behind a
 * Canton x402 payment via cantonPaymentMiddleware.
 *
 * The middleware advertises this route's `accepts[]` in the 402 and relays the
 * client's payment to the facilitator's /verify + /settle. The single
 * `accepts[]` entry built below advertises the transfer-factory ("V3", 1-tx
 * meta-transaction) settlement method — the ONLY method the stack speaks: the
 * payer signs a relay-prepared TransferFactory_Transfer (receiver = this
 * merchant) and the facilitator relays it in ONE tx (facilitator-sponsored gas,
 * no custody). It requires THIS merchant to hold a live TransferPreapproval (else
 * the transfer Pends and /settle fails closed). The merchant sets it up once:
 * `canton-agent-wallet preapproval`. Ensure the facilitator serves it
 * (CANTON_X402_TF_ENABLED).
 *
 * Configure via environment:
 *   PORT             — default 3000
 *   NETWORK          — CAIP-2 network, default canton:mainnet
 *   FACILITATOR_URL  — base URL of the facilitator the middleware calls,
 *                      default http://127.0.0.1:4123
 *
 *   X402_AMOUNT            — atomic CC units (1 CC = 10^10), default "500000000" (0.05 CC)
 *   CANTON_X402_PAYTO      — merchant party id (= accepts[].payTo)
 *   CANTON_X402_FACILITATOR — facilitator party id (= extra.feePayer)
 *   CANTON_SYNCHRONIZER_ID  — Global Synchronizer id (= extra.synchronizerId)
 *   CANTON_X402_DSO         — instrument admin / DSO party. Sets
 *                             extra.instrumentId = { admin: <DSO>, id: "Amulet" }
 *                             and asset = "<DSO>::Amulet".
 *   EXECUTE_BEFORE_SECONDS  — extra.executeBeforeSeconds, default 120.
 *
 * Legacy aliases still honored: PRICE → X402_AMOUNT, MERCHANT_PARTY →
 * CANTON_X402_PAYTO, FACILITATOR_PARTY → CANTON_X402_FACILITATOR,
 * SYNCHRONIZER_ID → CANTON_SYNCHRONIZER_ID, INSTRUMENT_ADMIN → CANTON_X402_DSO.
 *
 * Run (transfer-factory against a real facilitator):
 *   FACILITATOR_URL=https://facilitator.ftptech.xyz \
 *   CANTON_X402_FACILITATOR=facilitator::1220... \
 *   CANTON_SYNCHRONIZER_ID=global-domain::1220... \
 *   CANTON_X402_DSO=dso::1220... \
 *   CANTON_X402_PAYTO=merchant::1220... \
 *   pnpm --filter @ftptech/example-express-paid-api start
 */

import express from "express";
import { cantonPaymentMiddleware } from "@ftptech/x402-canton-express";
import type { PaymentRequirements } from "@ftptech/x402-canton-core";

const PORT = Number(process.env.PORT ?? 3000);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4123";
// Atomic CC units on the x402 wire under scheme "exact" (1 CC = 10^10).
const PRICE = process.env.X402_AMOUNT ?? process.env.PRICE ?? "500000000";
const MERCHANT_PARTY =
  process.env.CANTON_X402_PAYTO ??
  process.env.MERCHANT_PARTY ??
  "demo_merchant::1220000000000000000000000000000000000000000000000000000000000000";
const FACILITATOR_PARTY =
  process.env.CANTON_X402_FACILITATOR ??
  process.env.FACILITATOR_PARTY ??
  "demo_facilitator::1220fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const SYNCHRONIZER_ID =
  process.env.CANTON_SYNCHRONIZER_ID ??
  process.env.SYNCHRONIZER_ID ??
  "global-domain::1220xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const INSTRUMENT_ADMIN =
  process.env.CANTON_X402_DSO ??
  process.env.INSTRUMENT_ADMIN ??
  "dso::1220xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const INSTRUMENT_ID = process.env.INSTRUMENT_ID ?? "Amulet";
// asset is the symbolic "<admin>::Amulet" form so it stays consistent with
// extra.instrumentId (assertAssetInstrumentConsistency checks the `::` form).
const ASSET = `${INSTRUMENT_ADMIN}::${INSTRUMENT_ID}`;

const NETWORK = (process.env.NETWORK ??
  "canton:mainnet") as PaymentRequirements["network"];

// transfer-factory ("V3", 1-tx) is the ONLY settlement method: the payer signs a
// relay-prepared TransferFactory_Transfer and the facilitator relays it in ONE
// tx; requires THIS merchant to hold a live TransferPreapproval (else the
// transfer Pends). EXECUTE_BEFORE_SECONDS → extra.executeBeforeSeconds.
const EXECUTE_BEFORE_SECONDS = Number(process.env.EXECUTE_BEFORE_SECONDS ?? 120);

function buildRequirements(): PaymentRequirements {
  return {
    scheme: "exact" as const,
    network: NETWORK,
    amount: PRICE,
    asset: ASSET,
    payTo: MERCHANT_PARTY,
    maxTimeoutSeconds: 60,
    extra: {
      assetTransferMethod: "transfer-factory",
      feePayer: FACILITATOR_PARTY,
      synchronizerId: SYNCHRONIZER_ID,
      instrumentId: { admin: INSTRUMENT_ADMIN, id: INSTRUMENT_ID },
      executeBeforeSeconds: EXECUTE_BEFORE_SECONDS,
    },
  };
}

const dataRequirements: PaymentRequirements = buildRequirements();

const app = express();
app.use(express.json());

app.use(
  cantonPaymentMiddleware({
    routes: {
      "GET /api/data": {
        accepts: [dataRequirements],
        description: "Premium market data feed",
        mimeType: "application/json",
      },
    },
    facilitatorUrl: FACILITATOR_URL,
  })
);

app.get("/api/free", (_req, res) => {
  res.json({ free: true, note: "this route is not behind cantonPaymentMiddleware" });
});

app.get("/api/data", (_req, res) => {
  res.json({
    data: "premium-payload",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(
    `[express-paid-api] listening on ${PORT} ` +
      `(facilitator=${FACILITATOR_URL}, price=${PRICE} atomic CC, method=transfer-factory)`
  );
});
