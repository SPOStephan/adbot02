export function shouldHydrateSettingsFromQuery(input: {
  fetchedAfterMount: boolean;
  hasLocalChanges: boolean;
}): boolean {
  return input.fetchedAfterMount && !input.hasLocalChanges;
}
