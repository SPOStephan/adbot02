const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "span", "br"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntity(entity: string): string {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return '"';
  if (entity === "nbsp") return " ";
  return "";
}

function rgbToHex(r: number, g: number, b: number): string | null {
  if (![r, g, b].every(part => Number.isInteger(part) && part >= 0 && part <= 255)) return null;
  return `#${[r, g, b].map(part => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function allowedColor(value: string): string | null {
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  const rgb = hex.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!rgb) return null;
  return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
}

function spanColor(attrs: string): string | null {
  const style = attrs.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const raw = style?.[1] ?? style?.[2] ?? "";
  const color = raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return color ? allowedColor(color[1]) : null;
}

export function stripFormattedText(value: string): string {
  return sanitizeFormattedText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlankFormattedText(value: string): boolean {
  return stripFormattedText(value).length === 0;
}

export function sanitizeFormattedText(input: string): string {
  if (!input) return "";
  const source = input.replace(/\r\n/g, "\n");
  if (!/<[a-z/]/i.test(source)) return escapeHtml(source);

  let output = "";
  const open: string[] = [];
  let skipping: string | null = null;
  const token = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|&[a-z]+;|[^<&]+/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const chunk = match[0];
    if (chunk.startsWith("<!--")) continue;
    if (skipping) {
      const closeSkip = /^<\/([a-zA-Z]+)/.exec(chunk);
      if (closeSkip && closeSkip[1].toLowerCase() === skipping) skipping = null;
      continue;
    }
    if (chunk.startsWith("&")) {
      const decoded = decodeEntity(chunk.slice(1, -1));
      output += decoded ? escapeHtml(decoded) : "";
      continue;
    }
    if (!chunk.startsWith("<")) {
      output += escapeHtml(chunk);
      continue;
    }
    const close = /^<\/([a-zA-Z]+)/.exec(chunk);
    if (close) {
      const tag = close[1].toLowerCase();
      const index = open.lastIndexOf(tag);
      if (index === -1) continue;
      while (open.length > index) {
        const last = open.pop();
        if (last) output += `</${last}>`;
      }
      continue;
    }
    const openMatch = /^<([a-zA-Z]+)([^>]*)\/?>/.exec(chunk);
    if (!openMatch) continue;
    const tag = openMatch[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (!/\/>$/.test(chunk) && tag !== "br") skipping = tag;
      continue;
    }
    if (tag === "br") {
      output += "<br>";
      continue;
    }
    if (tag === "span") {
      const color = spanColor(openMatch[2] ?? "");
      if (!color) continue;
      open.push("span");
      output += `<span style="color: ${color}">`;
      continue;
    }
    open.push(tag);
    output += `<${tag}>`;
  }
  while (open.length) {
    const last = open.pop();
    if (last) output += `</${last}>`;
  }
  return output
    .replace(/<(b|strong|i|em|u|span)(?:\s[^>]*)?><\/\1>/g, "")
    .replace(/^(<br>)+|(<br>)+$/g, "");
}
