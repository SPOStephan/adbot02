import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const helper = await read("src/lib/meta/customer-control-route.ts");
assert.match(helper, /export function isDashboardSameOriginRequest/);
assert.match(helper, /export function isDashboardSameOriginReadRequest/);
assert.match(helper, /origin === request\.nextUrl\.origin/);
assert.match(helper, /fetchSite === "same-origin"/);
assert.match(helper, /if \(!isDashboardSameOriginRequest\(request\)\)/);

const routes = [
  ["src/app/api/connectors/meta/start/route.ts", "const supabase = await createClient"],
  ["src/app/api/connectors/meta/sync/route.ts", "authenticatedConnector()"],
  ["src/app/api/connectors/meta/disconnect/route.ts", "request.headers.get(\"content-type\")"],
  ["src/app/api/connectors/meta/assets/select-ad-account/route.ts", "request.headers.get(\"content-type\")"],
  ["src/app/api/connectors/meta/assets/prune/route.ts", "request.headers.get(\"content-type\")"],
  ["src/app/api/meta/automation/asset-upload/route.ts", "authenticateMetaCustomer()"],
];

for (const [path, mutationBoundary] of routes) {
  const source = await read(path);
  const post = source.slice(source.indexOf("export async function POST"));
  const guard = post.indexOf("isDashboardSameOriginRequest(request)");
  const boundary = post.indexOf(mutationBoundary);
  assert.ok(guard >= 0, `${path} must enforce the shared origin guard`);
  assert.ok(boundary >= 0, `${path} must retain its expected mutation boundary`);
  assert.ok(guard < boundary, `${path} must reject cross-site requests before state access`);
  assert.match(post, /invalid_origin|status:\s*403/);
}

console.log("Meta CSRF route checks passed.");
