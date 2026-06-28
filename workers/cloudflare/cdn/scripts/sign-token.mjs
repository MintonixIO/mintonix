#!/usr/bin/env node
/**
 * Mint a short-lived CDN view token for one object. This is a stand-in for what
 * the *orchestrator* will do server-side; the orchestrator holds the private
 * key and issues these tokens after it has authorized the user for the object.
 *
 *   CDN_JWT_PRIVATE_KEY="$(cat private.pem)" \
 *     node scripts/sign-token.mjs videos/abc/normalized.mp4 [ttlSeconds]
 *
 * Prints a ready-to-use URL query token. Default TTL: 300s (5 min).
 */
import { importPKCS8, SignJWT } from "jose";

const objectKey = process.argv[2];
const ttl = Number(process.argv[3] ?? "300");
if (!objectKey) {
  console.error("usage: sign-token.mjs <objectKey> [ttlSeconds]");
  process.exit(1);
}

const pem = process.env.CDN_JWT_PRIVATE_KEY;
if (!pem) {
  console.error("set CDN_JWT_PRIVATE_KEY to the PKCS8 private key PEM");
  process.exit(1);
}

const privateKey = await importPKCS8(pem, "EdDSA");
const token = await new SignJWT({ key: objectKey })
  .setProtectedHeader({ alg: "EdDSA" })
  .setIssuedAt()
  .setExpirationTime(`${ttl}s`)
  .sign(privateKey);

console.log(token);
