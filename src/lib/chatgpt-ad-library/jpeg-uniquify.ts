/**
 * Inspiration vault registration reuses a row when SHA-256 already exists.
 * Different ChatGPT ads often share a creative; trailing bytes after JPEG EOI
 * change the hash so each external_id can get its own vault row.
 */
export function uniquifyJpegBytes(bytes: Uint8Array, token: string): Uint8Array {
  const safe = String(token).replace(/[^\w.-]/g, "").slice(0, 32);
  const mark = new TextEncoder().encode(`\nADBOTCHATGPT:${safe}\n`);
  const out = new Uint8Array(bytes.length + mark.length);
  out.set(bytes);
  out.set(mark, bytes.length);
  return out;
}
