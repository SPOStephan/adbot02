import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "../../src/lib/chatgpt-ad-library");
const destDir = join(root, "lib/shared");

mkdirSync(destDir, { recursive: true });
for (const name of ["unlocker-core.ts", "parse-html.ts"]) {
  copyFileSync(join(sourceDir, name), join(destDir, name));
}

console.log("chatgpt-ad-library-worker: synced unlocker-core + parse-html");
