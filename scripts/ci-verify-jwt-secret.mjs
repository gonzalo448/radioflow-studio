/**
 * Falla si JWT_SECRET es demasiado corto para producción (V1-01).
 * Uso: NODE_ENV=production JWT_SECRET=... node scripts/ci-verify-jwt-secret.mjs
 */
const secret = process.env.JWT_SECRET ?? "";
const nodeEnv = process.env.NODE_ENV ?? "development";
const minLen = 32;

if (nodeEnv === "production" && secret.length < minLen) {
  console.error(
    `[ci-verify-jwt-secret] FAIL: JWT_SECRET debe tener ≥${minLen} caracteres en producción (tiene ${secret.length})`,
  );
  process.exit(1);
}

if (secret.length > 0 && secret.length < 16) {
  console.error(`[ci-verify-jwt-secret] FAIL: JWT_SECRET demasiado corto (mín 16, tiene ${secret.length})`);
  process.exit(1);
}

console.log(`[ci-verify-jwt-secret] OK: NODE_ENV=${nodeEnv}, JWT_SECRET length=${secret.length || 0}`);
