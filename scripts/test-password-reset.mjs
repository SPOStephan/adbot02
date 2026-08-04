import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

assert.match(read("src/components/AuthForm.tsx"), /Passwort vergessen\?/);
assert.match(read("src/components/ForgotPasswordForm.tsx"), /resetPasswordForEmail/);
assert.match(read("src/components/ForgotPasswordForm.tsx"), /\/passwort-neu/);
assert.match(read("src/components/UpdatePasswordForm.tsx"), /updateUser\(\{\s*password/);
assert.match(read("src/lib/site-urls.ts"), /\/passwort-vergessen/);
assert.match(read("src/lib/site-urls.ts"), /\/passwort-neu/);
assert.match(read("src/lib/supabase/proxy.ts"), /\/passwort-vergessen/);
assert.match(read("src/app/passwort-vergessen/page.tsx"), /ForgotPasswordForm/);
assert.match(read("src/app/passwort-neu/page.tsx"), /UpdatePasswordForm/);

console.log("test-password-reset: ok");
