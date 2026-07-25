import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const sourcePath = new URL("../src/lib/supabase/admin-env.ts", import.meta.url);
const source = (await readFile(sourcePath, "utf8")).replace(
  'import "server-only";',
  "",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-supabase-admin-env-"),
);
const modulePath = join(temporaryDirectory, "admin-env.mjs");
const originalModernKey = process.env.SUPABASE_SECRET_KEY;
const originalLegacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function setEnvironmentValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

try {
  await writeFile(modulePath, compiled, "utf8");
  const adminEnv = await import(pathToFileURL(modulePath).href);

  setEnvironmentValue("SUPABASE_SECRET_KEY", "  modern-secret-key  ");
  setEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role-key");
  assert.equal(adminEnv.hasSupabaseAdminKey(), true);
  assert.equal(adminEnv.getSupabaseAdminKey(), "modern-secret-key");

  setEnvironmentValue("SUPABASE_SECRET_KEY", "   ");
  assert.equal(adminEnv.hasSupabaseAdminKey(), true);
  assert.equal(adminEnv.getSupabaseAdminKey(), "legacy-service-role-key");

  setEnvironmentValue("SUPABASE_SECRET_KEY", undefined);
  setEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", "  legacy-only-key  ");
  assert.equal(adminEnv.getSupabaseAdminKey(), "legacy-only-key");

  setEnvironmentValue("SUPABASE_SECRET_KEY", undefined);
  setEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", undefined);
  assert.equal(adminEnv.hasSupabaseAdminKey(), false);
  assert.throws(
    () => adminEnv.getSupabaseAdminKey(),
    /SUPABASE_SECRET_KEY.*SUPABASE_SERVICE_ROLE_KEY/,
  );

  console.log("Supabase-Admin-Env-Tests erfolgreich.");
} finally {
  setEnvironmentValue("SUPABASE_SECRET_KEY", originalModernKey);
  setEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY", originalLegacyKey);
  await rm(temporaryDirectory, { force: true, recursive: true });
}
