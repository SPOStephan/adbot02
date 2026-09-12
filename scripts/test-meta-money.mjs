import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const source = await readFile(join(root, "src/lib/meta/money.ts"), "utf8");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-money-"));

try {
  const modulePath = join(temporaryDirectory, "money.mjs");
  await writeFile(modulePath, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText, "utf8");
  const { parseMetaCurrencyMinor } = await import(pathToFileURL(modulePath).href);

  assert.equal(parseMetaCurrencyMinor("0"), 0);
  assert.equal(parseMetaCurrencyMinor("1"), 100);
  assert.equal(parseMetaCurrencyMinor("1.2"), 120);
  assert.equal(parseMetaCurrencyMinor("1.23"), 123);
  assert.equal(parseMetaCurrencyMinor("1.230000"), 123);
  assert.equal(parseMetaCurrencyMinor("0.001"), null);
  assert.equal(parseMetaCurrencyMinor("1.234"), null);
  assert.equal(parseMetaCurrencyMinor("1e2"), null);
  assert.equal(parseMetaCurrencyMinor("-1.00"), null);
  assert.equal(parseMetaCurrencyMinor("90071992547409.91"), 9_007_199_254_740_991);
  assert.equal(parseMetaCurrencyMinor("90071992547409.92"), null);
  assert.equal(parseMetaCurrencyMinor(null), null);

  console.log("test-meta-money: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
