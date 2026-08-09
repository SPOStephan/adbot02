import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageRoot, "dist", "public");
const target = join(packageRoot, "public");
const indexHtml = join(source, "index.html");

if (!existsSync(indexHtml)) {
  console.error(`[prepare-vercel-public] Vite-Ausgabe fehlt: ${indexHtml}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`[prepare-vercel-public] ${source} → ${target}`);
