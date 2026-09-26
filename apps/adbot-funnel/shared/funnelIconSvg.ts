const ALLOWED_SVG_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "ellipse"]);
const ALLOWED_ATTR = new Set([
  "viewbox",
  "xmlns",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "transform",
  "opacity",
]);

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function sanitizeAttributes(raw: string): string {
  const attrs: string[] = [];
  const token = /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(raw))) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTR.has(name)) continue;
    const value = match[2] ?? match[3] ?? "";
    if (/javascript:|data:|expression\(/i.test(value)) continue;
    const outName = name === "viewbox" ? "viewBox" : name;
    attrs.push(`${outName}="${escapeAttr(value)}"`);
  }
  return attrs.join(" ");
}

export function sanitizeFunnelIconSvg(input: string): string | null {
  const source = input.trim();
  if (!source || source.length > 20_000) return null;
  if (!/<svg[\s>]/i.test(source)) return null;
  if (/<script|on[a-z]+\s*=|foreignObject|xlink:href/i.test(source)) return null;

  let output = "";
  const open: string[] = [];
  const token = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const chunk = match[0];
    if (!chunk.startsWith("<")) continue;
    const close = /^<\/([a-zA-Z]+)/.exec(chunk);
    if (close) {
      const tag = close[1].toLowerCase();
      if (open[open.length - 1] !== tag) continue;
      open.pop();
      output += `</${tag}>`;
      continue;
    }
    const openMatch = /^<([a-zA-Z]+)([^>]*)\/?>/.exec(chunk);
    if (!openMatch) continue;
    const tag = openMatch[1].toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) continue;
    const attrs = sanitizeAttributes(openMatch[2] ?? "");
    const selfClose = /\/>$/.test(chunk) || tag !== "svg" && tag !== "g";
    if (tag === "svg") {
      const viewBox = /viewBox="[^"]+"/.test(attrs) ? "" : ' viewBox="0 0 24 24"';
      open.push("svg");
      output += `<svg ${attrs}${viewBox} fill="none" aria-hidden="true">`;
      continue;
    }
    if (selfClose) {
      output += `<${tag}${attrs ? ` ${attrs}` : ""} />`;
      continue;
    }
    open.push(tag);
    output += `<${tag}${attrs ? ` ${attrs}` : ""}>`;
  }
  while (open.length) {
    const last = open.pop();
    if (last) output += `</${last}>`;
  }
  if (!output.includes("<svg")) return null;
  return output;
}

export function placeholderFunnelIconSvg(_label: string): string {
  return '<svg viewBox="-2.5 -2.5 29 29" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.55" /><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" /></svg>';
}
