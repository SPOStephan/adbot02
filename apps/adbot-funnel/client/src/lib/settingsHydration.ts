export const SETTINGS_QUERY_OPTIONS = {
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: false,
};

export function shouldHydrateSettingsFromQuery(input: {
  fetchedAfterMount: boolean;
  hasLocalChanges: boolean;
}): boolean {
  return input.fetchedAfterMount && !input.hasLocalChanges;
}
