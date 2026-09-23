function normalizeCreativeTags(value) {
  const source = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return [
    ...new Set(
      source
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
    .slice(0, 12)
    .map((item) => item.slice(0, 40));
}

module.exports = { normalizeCreativeTags };
