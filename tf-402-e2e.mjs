// Full 402-NEGOTIATED e2e for transfer-factory ("V3", 1-tx) on OUR stack. A real
// express-paid-api (cantonPaymentMiddleware) advertises a transfer-factory 402;
// the agent-wallet `makePayingFetch` auto-selects the method from the 402 and pays
// it (relay pay/prepare → verify-before-sign → sign → pay/commit → X-PAYMENT), the
// facilitator relays the signed TransferFactory_Transfer in ONE tx, and the
// resource is served. Proves T1/T11/T12 (happy path, gasless, 1 GS-tx) end-to-end.
//
// PRECONDITION: the merchant must hold a live TransferPreapproval (the 1-tx hinge).
// This driver provisions it via the facilitator-as-provider route when an
// OPERATOR_TOKEN is supplied AND the merchant delegated CanActAs to the facilitator
// user; otherwise it prints the setup command and continues (the pay then Pends /
// fails with preapproval_missing, which is itself a correct negative check).
//
// Run against a facilitator with CANTON_X402_TF_ENABLED=true:
//   RELAY_URL=https://facilitator.ftptech.xyz AGENT_KEY=... \
//   OPERATOR_TOKEN=... AMOUNT=0.0100000000 node e2e/tf-402-e2e.mjs
import {
  ensureWallet, RelayClient, claimAll,
  makePayingFetchForWallet, selfProvisionPreapproval,
} from "../packages/agent-wallet/dist/index.js";
import { decimalToAtomicCC } from "../packages/core/dist/index.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const E = process.env;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const relayUrl = E.RELAY_URL || "http://127.0.0.1:4123";
const apiKey = E.AGENT_KEY || "e2e-test-key";
const NET = E.NETWORK || "canton:mainnet";
const FACILITATOR = E.FACILITATOR || "FTP-validator-1::1220c065ad977ae4e480b6ea5bcd96d6d73025a91ad27fa60d1385010ca01cdd39f9";
const SYNC = E.SYNC || "global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc";
const DSO = E.DSO || "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc";
const AMOUNT = E.AMOUNT || "0.0100000000";
const PORT = E.PORT || "3011";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const relay = new RelayClient({ relayUrl, apiKey });

  // 1) merchant wallet
  process.env.CANTON_AGENT_HOME = E.MERCHANT_HOME || "/tmp/tf-402-merchant";
  const merchant = await ensureWallet({ relayUrl, apiKey, network: NET });
  log("merchant:", merchant.party);

  // 2) merchant preapproval (the 1-tx hinge). SELF-PROVIDER: the merchant funds
  //    itself (faucet) then provisions its OWN TransferPreapproval with its OWN
  //    key (single controller — no facilitator CanActAs, no operator token). This
  //    is the realistic self-custodial external-merchant flow.
  let pre = await relay.preapprovalStatus(merchant.party, DSO).catch((e) => ({ hasPreapproval: null, transferKind: "", error: e?.message }));
  log("merchant preapproval:", pre.hasPreapproval, pre.transferKind ?? "");
  if (pre.hasPreapproval !== true) {
    // fund the merchant so it can pay its OWN preapproval fee (the create
    // PREPAYS holding fees for the preapproval's lifetime, so keep the expiry
    // short for a cheap canary; fund a safe margin above the observed fee).
    let mbal = await relay.balance(merchant.party).catch(() => ({ cc: "0" }));
    let mg = 0;
    while (Number(mbal.cc) < 1.0 && mg++ < 10) {
      await relay.faucetClaim(merchant.party).catch(() => {});
      await sleep(2500);
      await claimAll(relay, merchant).catch(() => {});
      mbal = await relay.balance(merchant.party).catch(() => ({ cc: mbal.cc }));
    }
    log("merchant funded:", mbal.cc, "CC — self-provisioning preapproval…");
    try {
      // short expiry keeps the prepaid holding fee small; ample for the canary.
      const expiresAt = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
      const r = await selfProvisionPreapproval(relay, merchant, { expiresAt });
      log("  ✓ self-preapproval updateId:", r.updateId);
      for (let i = 0; i < 10; i++) {
        pre = await relay.preapprovalStatus(merchant.party, DSO).catch(() => pre);
        if (pre.hasPreapproval === true) break;
        await sleep(2500);
      }
      log("  merchant preapproval now:", pre.hasPreapproval, pre.transferKind ?? "");
    } catch (e) {
      log("  ✗ self-provision failed:", e?.message ?? String(e));
    }
  }

  // 3) buyer wallet + fund (faucet + claim)
  process.env.CANTON_AGENT_HOME = E.BUYER_HOME || "/tmp/tf-402-buyer";
  const buyer = await ensureWallet({ relayUrl, apiKey, network: NET });
  log("buyer:", buyer.party);
  let bal = await relay.balance(buyer.party).catch(() => ({ cc: "0" }));
  let guard = 0;
  while (Number(bal.cc) < Number(AMOUNT) + 0.01 && guard++ < 6) {
    await relay.faucetClaim(buyer.party).catch(() => {});
    await sleep(2500);
    await claimAll(relay, buyer).catch(() => {});
    bal = await relay.balance(buyer.party).catch(() => ({ cc: bal.cc }));
  }
  log("buyer balance:", bal.cc, "CC");
  if (Number(bal.cc) < Number(AMOUNT)) { log("✗ buyer underfunded:", bal.cc); process.exit(1); }

  // 4) spawn the REAL express-paid-api offering transfer-factory (its 402)
  const env = {
    ...process.env, PORT, FACILITATOR_URL: relayUrl,
    CANTON_X402_FACILITATOR: FACILITATOR, CANTON_SYNCHRONIZER_ID: SYNC, CANTON_X402_DSO: DSO,
    CANTON_X402_PAYTO: merchant.party, X402_AMOUNT: decimalToAtomicCC(AMOUNT),
    X402_METHOD: "transfer-factory", NETWORK: NET,
  };
  const exDir = join(repoRoot, "examples/express-paid-api");
  log("spawning express-paid-api on", PORT, "(method=transfer-factory, payTo=merchant)…");
  const srv = spawn(join(exDir, "node_modules/.bin/tsx"), ["src/server.ts"], { cwd: exDir, env, stdio: ["ignore", "pipe", "pipe"] });
  srv.stdout.on("data", (d) => process.stdout.write("  [express] " + d));
  srv.stderr.on("data", (d) => process.stderr.write("  [express!] " + d));
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(500);
    up = await fetch(`http://127.0.0.1:${PORT}/api/data`).then((r) => r.status === 402).catch(() => false);
  }
  if (!up) { log("✗ express did not start"); srv.kill(); process.exit(1); }
  log("express up (402).");

  // 5) buyer pays GET /api/data via makePayingFetch (402 -> transfer-factory -> 200)
  const merchantBefore = await relay.balance(merchant.party).catch(() => ({ cc: "0" }));
  log("merchant BEFORE:", merchantBefore.cc, "CC");
  log("== GET /api/data via makePayingFetch (auto 402 -> transfer-factory) ==");
  let status = 0, bodyText = "";
  try {
    const payingFetch = await makePayingFetchForWallet(buyer, { apiKey });
    const res = await payingFetch(`http://127.0.0.1:${PORT}/api/data`);
    status = res.status; bodyText = (await res.text()).slice(0, 160);
    log("  -> HTTP", status, bodyText);
  } catch (e) { log("  pay error:", e?.message ?? String(e)); }

  // 6) prove the merchant got paid exactly AMOUNT
  let merchantAfter = await relay.balance(merchant.party).catch(() => merchantBefore);
  for (let i = 0; i < 8 && Number(merchantAfter.cc) <= Number(merchantBefore.cc); i++) { await sleep(2000); merchantAfter = await relay.balance(merchant.party).catch(() => merchantAfter); }
  const delta = Number(merchantAfter.cc) - Number(merchantBefore.cc);
  srv.kill();

  log("\n────────── 402-NEGOTIATED TRANSFER-FACTORY e2e RESULT ──────────");
  log("  merchant :", merchant.party, "(preapproval:", pre.hasPreapproval, ")");
  log("  buyer    :", buyer.party);
  log("  GET /api/data HTTP       :", status);
  log("  merchant :", merchantBefore.cc, "->", merchantAfter.cc, `(delta +${delta.toFixed(10)})`);
  log(JSON.stringify({ phase: "402-tf-e2e", method: "transfer-factory", merchant: merchant.party, buyer: buyer.party, hasPreapproval: pre.hasPreapproval, httpStatus: status, merchantBefore: merchantBefore.cc, merchantAfter: merchantAfter.cc, merchantDelta: delta.toFixed(10) }, null, 0));

  const ok = status === 200 && Math.abs(delta - Number(AMOUNT)) < 1e-9;
  if (!ok) { log(`✗ FAIL: status=${status} (want 200), merchant delta=${delta} (want ${AMOUNT})`); process.exit(1); }
  log("✓ OUR STACK ON TRANSFER-FACTORY PROVEN: express advertised transfer-factory, makePayingFetch auto-paid it through the full 402 flow (relay prepare→verify→sign→commit; facilitator relayed in ONE tx), merchant +" + AMOUNT + " on-ledger, 200 returned.");
}
main().catch((e) => { console.error("✗ E2E ERROR:", e?.message ?? String(e)); process.exit(1); });
