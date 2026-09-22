/**
 * Inspiration vault registration reuses a row when SHA-256 already exists.
 * Different ChatGPT ads often share a creative. A COM segment *before* EOI
 * changes the hash while the file stays a valid JPEG (FFD8…FFD9). Trailing
 * bytes after EOI used to change the hash too — and then failed
 * `inspectCreativeImage` ("keine gültige JPEG-Datei").
 */
export function uniquifyJpegBytes(bytes: Uint8Array, token: string): Uint8Array {
  const safe = String(token).replace(/[^\w.-]/g, "").slice(0, 32);
  const mark = new TextEncoder().encode(`ADBOTCHATGPT:${safe}`);
  const payloadLength = 2 + mark.length;
  if (payloadLength > 0xffff) {
    throw new RangeError("JPEG COM segment would exceed 65535 bytes.");
  }

  const eoiAt =
    bytes.length >= 2 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
      ? bytes.length - 2
      : bytes.length;

  const out = new Uint8Array(eoiAt + 2 + 2 + mark.length + 2);
  out.set(bytes.subarray(0, eoiAt));
  let offset = eoiAt;
  out[offset++] = 0xff;
  out[offset++] = 0xfe;
  out[offset++] = (payloadLength >> 8) & 0xff;
  out[offset++] = payloadLength & 0xff;
  out.set(mark, offset);
  offset += mark.length;
  out[offset++] = 0xff;
  out[offset++] = 0xd9;
  return out;
}
