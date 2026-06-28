#!/usr/bin/env node
/**
 * Generate an Ed25519 keypair for CDN view tokens.
 *
 *   node scripts/keygen.mjs
 *
 * - PUBLIC key  -> set as the Worker var CDN_JWT_PUBLIC_KEY (safe to commit/share).
 * - PRIVATE key -> keep ONLY in the orchestrator (a secret). The Worker never
 *   sees it, so the edge can verify tokens but never mint them.
 */
import { generateKeyPair, exportSPKI, exportPKCS8 } from "jose";

const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
  crv: "Ed25519",
  extractable: true,
});

const spki = await exportSPKI(publicKey);
const pkcs8 = await exportPKCS8(privateKey);

console.log("# ---- PUBLIC key  (Worker: CDN_JWT_PUBLIC_KEY) ----");
console.log(spki);
console.log("# ---- PRIVATE key (orchestrator secret ONLY) -----");
console.log(pkcs8);
