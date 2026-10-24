// End-to-end x402 payment on Canton MainNet against a live facilitator.
//
// 1. Creates (or reuses) a merchant wallet and a buyer wallet. A new wallet
//    accepts the relay's starter grant if one is sent.
// 2. The merchant creates its own TransferPreapproval with its own key, paying
//    the fee from its own CC.
// 3. Starts the bundled express-paid-api, which answers GET /api/data with a 402
//    for AMOUNT CC to the merchant (method transfer-factory).
// 4. The buyer pays through makePayingFetchForWallet: relay pay/prepare, verify
//    before sign, sign, then PAYMENT-SIGNATURE carries the prepared transaction,
//    its hash and the signature. The facilitator runs /verify and /settle and
//    submits the transfer in one transaction.
// 5. Passes when the request returns 200 and the merchant balance grew by
//    exactly AMOUNT.
//
// This spends real CC. Run: node tf-402-e2e.mjs
import {
  ensureWallet, RelayClient, claimAll,
  makePayingFetchForWallet, selfProvisionPreapproval,
} from "@ftptech/canton-agent-wallet";
import { decimalToAtomicCC, decodeBase64Json } from "@ftptech/x402-canton-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const E = process.env;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HERE = dirname(fileURLToPath(import.meta.url));
const relayUrl = (E.RELAY_URL || "https://facilitator.ftptech.xyz").replace(/\/+$/, "");
const apiKey = E.AGENT_KEY || undefined;
const NET = E.NETWORK || "canton:mainnet";
const DSO = E.DSO || "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc";
const AMOUNT = E.AMOUNT || "0.0100000000";
const PORT = E.PORT || "3011";
const MERCHANT_HOME = resolve(E.MERCHANT_HOME || join(HERE, ".wallets/merchant"));
const BUYER_HOME = resolve(E.BUYER_HOME || join(HERE, ".wallets/buyer"));

// feePayer and synchronizerId come from the facilitator's GET /supported.
async function readSupported() {
  try {
    const r = await fetch(`${relayUrl}/supported`);
    if (!r.ok) return {};
    const s = await r.json();
    const kind = (s.kinds || []).find((k) => k.network === NET) || {};
    return { feePayer: s.signers?.["canton:*"]?.[0], synchronizerId: kind.extra?.synchronizerId };
  } catch {
    return {};
  }
}

function fundHint(who, party, home) {
  log(`  send CC to the ${who} party: ${party}`);
  log(`  then rerun, or accept it now: CANTON_AGENT_HOME=${home} npx @ftptech/canton-agent-wallet claim`);
}

async function openWallet(who, home) {
  process.env.CANTON_AGENT_HOME = home;
  const w = await ensureWallet({
    relayUrl, apiKey, network: NET,
    onStarterGrant: (g) => log(`  ${who} starter grant: ${g.status} ${g.amountCc} CC`),
  });
  await claimAll(relay, w).catch(() => {});
  log(`${who}:`, w.party, `(home ${home})`);
  return w;
}

const relay = new RelayClient({ relayUrl, apiKey });

async function main() {
  const sup = await readSupported();
  const FACILITATOR = E.FACILITATOR || sup.feePayer;
  const SYNC = E.SYNC || sup.synchronizerId;
  if (!FACILITATOR || !SYNC) {
    log(`✗ could not read feePayer and synchronizerId from ${relayUrl}/supported; set FACILITATOR and SYNC`);
    process.exit(1);
  }
  log("facilitator:", relayUrl, "feePayer:", FACILITATOR);

  // 1) merchant wallet and its TransferPreapproval
  const merchant = await openWallet("merchant", MERCHANT_HOME);
  let pre = await relay.preapprovalStatus(merchant.party, DSO).catch((e) => ({ hasPreapproval: null, error: e?.message }));
  log("merchant preapproval:", pre.hasPreapproval, pre.expiresAt ?? "");
  if (pre.hasPreapproval !== true) {
    const mbal = await relay.balance(merchant.party).catch(() => ({ cc: "?" }));
    log("merchant balance:", mbal.cc, "CC. Creating preapproval (2 days)...");
    try {
      // A short expiry keeps the prepaid fee small.
      const expiresAt = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
      const r = await selfProvisionPreapproval(relay, merchant, { expiresAt });
      log("  preapproval updateId:", r.updateId);
      for (let i = 0; i < 10; i++) {
        pre = await relay.preapprovalStatus(merchant.party, DSO).catch(() => pre);
        if (pre.hasPreapproval === true) break;
        await sleep(2500);
      }
    } catch (e) {
      log("✗ preapproval failed:", e?.message ?? String(e));
      fundHint("merchant", merchant.party, MERCHANT_HOME);
      process.exit(1);
    }
    if (pre.hasPreapproval !== true) { log("✗ preapproval not visible yet; rerun shortly"); process.exit(1); }
  }

  // 2) buyer wallet, funded with at least AMOUNT
  const buyer = await openWallet("buyer", BUYER_HOME);
  const bal = await relay.balance(buyer.party).catch(() => ({ cc: "0" }));
  log("buyer balance:", bal.cc, "CC");
  if (!(Number(bal.cc) >= Number(AMOUNT))) {
    log(`✗ buyer underfunded: needs ${AMOUNT} CC`);
    fundHint("buyer", buyer.party, BUYER_HOME);
    process.exit(1);
  }

  // 3) start the example merchant API
  const env = {
    ...process.env, PORT, FACILITATOR_URL: relayUrl, NETWORK: NET,
    CANTON_X402_FACILITATOR: FACILITATOR, CANTON_SYNCHRONIZER_ID: SYNC, CANTON_X402_DSO: DSO,
    CANTON_X402_PAYTO: merchant.party, X402_AMOUNT: decimalToAtomicCC(AMOUNT),
  };
  const exDir = join(HERE, "express-paid-api");
  log("starting express-paid-api on", PORT);
  const srv = spawn(process.execPath, ["--max-http-header-size=32768", "--import", "tsx", "src/server.ts"], {
    cwd: exDir, env, stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", (d) => process.stdout.write("  [express] " + d));
  srv.stderr.on("data", (d) => process.stderr.write("  [express!] " + d));
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(500);
    up = await fetch(`http://127.0.0.1:${PORT}/api/data`).then((r) => r.status === 402).catch(() => false);
  }
  if (!up) { log("✗ express did not start"); srv.kill(); process.exit(1); }

  // 4) buyer pays GET /api/data
  const merchantBefore = await relay.balance(merchant.party).catch(() => ({ cc: "0" }));
  log("merchant before:", merchantBefore.cc, "CC");
  let status = 0, bodyText = "", updateId = "";
  try {
    const payingFetch = await makePayingFetchForWallet(buyer, { apiKey, expectedPayTo: merchant.party }, BUYER_HOME);
    const res = await payingFetch(`http://127.0.0.1:${PORT}/api/data`);
    status = res.status; bodyText = (await res.text()).slice(0, 160);
    const pr = res.headers.get("PAYMENT-RESPONSE");
    if (pr) { try { updateId = decodeBase64Json(pr).transaction || ""; } catch {} }
    log("  HTTP", status, bodyText);
  } catch (e) { log("  pay error:", e?.message ?? String(e)); }

  // 5) the merchant got exactly AMOUNT
  let merchantAfter = await relay.balance(merchant.party).catch(() => merchantBefore);
  for (let i = 0; i < 8 && Number(merchantAfter.cc) <= Number(merchantBefore.cc); i++) {
    await sleep(2000);
    merchantAfter = await relay.balance(merchant.party).catch(() => merchantAfter);
  }
  const delta = Number(merchantAfter.cc) - Number(merchantBefore.cc);
  srv.kill();

  log("\nresult");
  log("  merchant :", merchant.party);
  log("  buyer    :", buyer.party);
  log("  HTTP     :", status);
  log("  updateId :", updateId || "(none)");
  log("  merchant :", merchantBefore.cc, "->", merchantAfter.cc, `(+${delta.toFixed(10)})`);

  const ok = status === 200 && Math.abs(delta - Number(AMOUNT)) < 1e-9;
  if (!ok) { log(`✗ FAIL: status=${status} (want 200), merchant delta=${delta} (want ${AMOUNT})`); process.exit(1); }
  log(`✓ PASS: paid ${AMOUNT} CC, 200 returned`);
}
main().catch((e) => { console.error("✗ E2E ERROR:", e?.message ?? String(e)); process.exit(1); });
