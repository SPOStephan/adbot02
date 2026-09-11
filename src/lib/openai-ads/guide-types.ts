export type OpenAIAdsGuideStep = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
  imageUrl: string;
  width: number;
  height: number;
  originalFilename: string;
  updatedAt: string;
};

export type OpenAIAdsGuide = {
  published: boolean;
  updatedAt: string | null;
  steps: OpenAIAdsGuideStep[];
};
