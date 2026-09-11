import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

assert.match(read("src/components/AuthForm.tsx"), /Passwort vergessen\?/);
assert.match(read("src/components/AuthForm.tsx"), /PasswordInput/);
assert.match(read("src/components/ForgotPasswordForm.tsx"), /resetPasswordForEmail/);
assert.match(read("src/components/ForgotPasswordForm.tsx"), /\/passwort-neu/);
assert.match(read("src/components/UpdatePasswordForm.tsx"), /updateUser\(\{\s*password/);
assert.match(read("src/components/UpdatePasswordForm.tsx"), /PasswordInput/);
assert.match(read("src/components/PasswordInput.tsx"), /Passwort anzeigen/);
assert.match(read("src/components/PasswordInput.tsx"), /EyeOff/);
assert.match(read("src/lib/site-urls.ts"), /\/passwort-vergessen/);
assert.match(read("src/lib/site-urls.ts"), /\/passwort-neu/);
assert.match(read("src/lib/supabase/proxy.ts"), /\/passwort-vergessen/);
assert.match(read("src/app/passwort-vergessen/page.tsx"), /ForgotPasswordForm/);
assert.match(read("src/app/passwort-neu/page.tsx"), /UpdatePasswordForm/);

const safeNextPathSource = read("src/lib/auth/safe-next-path.ts");
assert.match(safeNextPathSource, /candidate\.startsWith\("\/\/"\)/);
assert.match(safeNextPathSource, /candidate\.includes\("\\\\"\)/);
assert.match(safeNextPathSource, /%2f\|%5c/i);
assert.match(safeNextPathSource, /parsed\.origin !== SAFE_ORIGIN/);
assert.match(read("src/app/auth/callback/route.ts"), /normalizeSafeNextPath/);
assert.match(read("src/components/AuthForm.tsx"), /normalizeSafeNextPath/);

console.log("test-password-reset: ok");
