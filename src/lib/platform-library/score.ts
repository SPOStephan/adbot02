export type PlatformMotifScoreInput = {
  tags: readonly string[];
  contentSummary: string | null;
  filename: string;
  queryTags?: readonly string[];
  queryText?: string | null;
};

const TOKEN_RE = /[a-zäöüß0-9]{3,}/gi;

export function tokensFromQueryText(value: string | null | undefined): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .toLowerCase()
        .match(TOKEN_RE)
        ?.map((item) => item.slice(0, 40)) ?? [],
    ),
  ].slice(0, 24);
}

/** Higher score = better Adbot match. 0 means no useful overlap. */
export function scorePlatformMotifMatch(input: PlatformMotifScoreInput): number {
  const tags = new Set(
    input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
  );
  const queryTags = [
    ...new Set(
      (input.queryTags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  const tokens = tokensFromQueryText(input.queryText);
  const haystack = [
    input.filename,
    input.contentSummary ?? "",
    ...input.tags,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const tag of queryTags) {
    if (tags.has(tag)) score += 3;
    else if (haystack.includes(tag)) score += 1;
  }
  for (const token of tokens) {
    if (tags.has(token)) score += 2;
    else if (haystack.includes(token)) score += 1;
  }
  return score;
}

/** Two exact tag hits (or equivalent) is enough to copy 1:1 instead of restyle. */
export function shouldAdoptPlatformMotifOneToOne(score: number): boolean {
  return score >= 6;
}
