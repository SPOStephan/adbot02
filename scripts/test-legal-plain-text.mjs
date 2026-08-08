import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import vm from "node:vm";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const impressum = read("content/legal/impressum.md");
const datenschutz = read("content/legal/datenschutz.md");
const agb = read("content/legal/agb.md");
assert.doesNotMatch(impressum, /^#/m);
assert.doesNotMatch(datenschutz, /^#/m);
assert.doesNotMatch(agb, /^#/m);
assert.doesNotMatch(impressum, /^##/m);
assert.doesNotMatch(datenschutz, /^##/m);
assert.doesNotMatch(agb, /^##/m);

const pagesTs = read("src/lib/legal/pages.ts");
assert.match(pagesTs, /normalizeLegalPlainText/);

const editor = read("src/components/LegalPagesEditor.tsx");
assert.match(editor, /Klartext/);
assert.doesNotMatch(editor, /Markdown-Überschriften/);

const migration = read(
  "supabase/migrations/20260808120000_legal_pages_strip_markdown_headings.sql",
);
assert.match(migration, /regexp_replace/);
assert.match(migration, /site_legal_pages/);

const source = read("src/lib/legal/plain-text.ts");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(transpiled, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
});

const { normalizeLegalPlainText } = module.exports;
assert.equal(
  normalizeLegalPlainText("# Impressum\n\n## Anbieter\nFirma"),
  "Impressum\n\nAnbieter\nFirma",
);
assert.equal(
  normalizeLegalPlainText("## 1. Verantwortlicher  \nName"),
  "1. Verantwortlicher\nName",
);

console.log("test-legal-plain-text: ok");
