/** Meta Ad Study (split test) payload — no secrets, safe to unit-test. */

export type SplitTestAdStudyCell = {
  name: string;
  treatment_percentage: number;
  adsets: string[];
};

export type SplitTestAdStudyPayload = {
  name: string;
  description: string;
  start_time: number;
  end_time: number;
  type: "SPLIT_TEST";
  cells: [SplitTestAdStudyCell, SplitTestAdStudyCell];
};

export function buildSplitTestAdStudyPayload(input: {
  name: string;
  description?: string;
  startTimeUnix: number;
  endTimeUnix: number;
  adSetA: string;
  adSetB: string;
}): SplitTestAdStudyPayload {
  if (!/^[1-9][0-9]{0,39}$/.test(input.adSetA) || !/^[1-9][0-9]{0,39}$/.test(input.adSetB)) {
    throw new Error("Ad-Set-IDs für das Meta-Experiment sind ungültig.");
  }
  if (input.adSetA === input.adSetB) {
    throw new Error("Meta-Experiment braucht zwei verschiedene Ad Sets.");
  }
  if (input.endTimeUnix <= input.startTimeUnix) {
    throw new Error("Meta-Experiment braucht ein gültiges Zeitfenster.");
  }
  return {
    name: input.name.slice(0, 120),
    description: (input.description ?? "Adbot Funnel-Splittest").slice(0, 500),
    start_time: input.startTimeUnix,
    end_time: input.endTimeUnix,
    type: "SPLIT_TEST",
    cells: [
      {
        name: "Funnel A",
        treatment_percentage: 50,
        adsets: [input.adSetA],
      },
      {
        name: "Funnel B",
        treatment_percentage: 50,
        adsets: [input.adSetB],
      },
    ],
  };
}
