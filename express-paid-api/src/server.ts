/**
 * Example resource server that gates GET /api/data behind a
 * Canton x402 payment via cantonPaymentMiddleware.
 *
 * The middleware answers 402 with this route's accepts[] and forwards the
 * client's payment to the facilitator's /verify and /settle. The accepts[]
 * entry uses the transfer-factory method: the payer signs a relay-prepared
 * TransferFactory_Transfer to this merchant and the facilitator submits it in
 * one transaction and pays the gas. The merchant must hold a live
 * TransferPreapproval, created once with `canton-agent-wallet preapproval`.
 *
 * Environment:
 *   PORT                    default 3000
 *   NETWORK                 CAIP-2 network, default canton:mainnet
 *   FACILITATOR_URL         facilitator base URL, default http://127.0.0.1:4123
 *   X402_AMOUNT             atomic CC units (1 CC = 10^10), default 500000000 (0.05 CC)
 *   CANTON_X402_PAYTO       merchant party id (accepts[].payTo)
 *   CANTON_X402_FACILITATOR facilitator party id (extra.feePayer), from GET /supported signers
 *   CANTON_SYNCHRONIZER_ID  Global Synchronizer id (extra.synchronizerId)
 *   CANTON_X402_DSO         DSO party. Sets extra.instrumentId = { admin: <DSO>, id: "Amulet" }
 *                           and asset = "<DSO>::Amulet". Required for a real payment.
 *   EXECUTE_BEFORE_SECONDS  extra.executeBeforeSeconds, default 120
 *
 * Legacy aliases: PRICE, MERCHANT_PARTY, FACILITATOR_PARTY, SYNCHRONIZER_ID,
 * INSTRUMENT_ADMIN.
 *
 * Run with `npm start`. See README.md.
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

// How long the signed transfer stays valid (extra.executeBeforeSeconds).
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
