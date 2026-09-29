// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I), damit es sich gut weitergeben lässt.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function suggestPassword(groups = 4, groupLength = 4): string {
  const values = new Uint32Array(groups * groupLength);
  crypto.getRandomValues(values);
  const chars = Array.from(values, value => ALPHABET[value % ALPHABET.length]);
  const parts: string[] = [];
  for (let index = 0; index < groups; index += 1) {
    parts.push(chars.slice(index * groupLength, (index + 1) * groupLength).join(""));
  }
  return parts.join("-");
}
