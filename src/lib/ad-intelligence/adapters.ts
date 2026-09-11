import {
  AdIntelligenceContractError,
  type AdIntelligencePackage,
} from "@/lib/ad-intelligence/contract";

export type MetaAdIntelligenceOutput = {
  platform: "meta";
  primaryText: string;
  headline: string;
  description: string;
  ctaIntent: string;
  creativeConcept: string;
};

export type OpenAIAdsIntelligenceOutput = {
  platform: "openai_ads";
  creative: {
    type: "chat_card";
    title: string;
    body: string;
    target_url: string;
  };
  imagePrompt: string;
};

export type GoogleAdIntelligenceOutput = {
  platform: "google";
  responsiveSearchAd: {
    headlines: string[];
    descriptions: string[];
    finalUrl: string;
  };
};

export type TikTokAdIntelligenceOutput = {
  platform: "tiktok";
  adText: string;
  displayName: string;
  ctaIntent: string;
  videoHook: string;
  voiceover: string;
  aspectRatio: "9:16";
  aiGeneratedContentDisclosureRequired: true;
};

export type AdIntelligencePlatformOutput =
  | MetaAdIntelligenceOutput
  | OpenAIAdsIntelligenceOutput
  | GoogleAdIntelligenceOutput
  | TikTokAdIntelligenceOutput;

type AdapterContext = {
  destinationUrl: string;
  brandName: string;
};

function chars(value: string): number {
  return Array.from(value).length;
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= maximum) return value.trim();
  if (maximum < 2) return characters.slice(0, maximum).join("");
  return `${characters.slice(0, maximum - 1).join("").trimEnd()}…`;
}

function requiredAndTruncated(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = truncate(value, maximum);
  if (chars(normalized) < minimum) {
    throw new AdIntelligenceContractError(
      `${field} benötigt mindestens ${minimum} Zeichen.`,
    );
  }
  return normalized;
}

function tiktokChars(value: string): number {
  return Array.from(value).reduce(
    (sum, character) =>
      sum + (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character) ? 2 : 1),
    0,
  );
}

function requireHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || value.length > 2_048) {
    throw new AdIntelligenceContractError("Ziel-URL ist ungültig.");
  }
  return url.toString();
}

export function adaptAdIntelligencePackage(
  value: AdIntelligencePackage,
  context: AdapterContext,
): AdIntelligencePlatformOutput {
  const destinationUrl = requireHttpsUrl(context.destinationUrl);

  switch (value.platform) {
    case "meta":
      return {
        platform: "meta",
        primaryText: requiredAndTruncated(
          value.copy.primary_text,
          "Meta Primary Text",
          1,
          125,
        ),
        headline: requiredAndTruncated(
          value.copy.headline,
          "Meta Headline",
          1,
          40,
        ),
        description: truncate(value.copy.description, 25),
        ctaIntent: value.copy.cta,
        creativeConcept: value.creative.concept,
      };

    case "openai_ads":
      return {
        platform: "openai_ads",
        creative: {
          type: "chat_card",
          title: requiredAndTruncated(
            value.copy.headline,
            "OpenAI Ads Title",
            3,
            50,
          ),
          body: requiredAndTruncated(
            value.copy.primary_text,
            "OpenAI Ads Body",
            1,
            100,
          ),
          target_url: destinationUrl,
        },
        imagePrompt: value.creative.image_prompt,
      };

    case "google": {
      if (
        value.copy.search_headlines.length < 3 ||
        value.copy.search_headlines.length > 15
      ) {
        throw new AdIntelligenceContractError(
          "Google RSA benötigt 3–15 Headlines.",
        );
      }
      if (
        value.copy.search_descriptions.length < 2 ||
        value.copy.search_descriptions.length > 4
      ) {
        throw new AdIntelligenceContractError(
          "Google RSA benötigt 2–4 Descriptions.",
        );
      }
      return {
        platform: "google",
        responsiveSearchAd: {
          headlines: value.copy.search_headlines.map((headline, index) =>
            requiredAndTruncated(
              headline,
              `Google Headline ${index + 1}`,
              1,
              30,
            ),
          ),
          descriptions: value.copy.search_descriptions.map(
            (description, index) =>
              requiredAndTruncated(
                description,
                `Google Description ${index + 1}`,
                1,
                90,
              ),
          ),
          finalUrl: destinationUrl,
        },
      };
    }

    case "tiktok": {
      const cleanText = value.copy.primary_text.replace(
        /[@#\p{Extended_Pictographic}]/gu,
        "",
      );
      let adText = cleanText.trim();
      while (adText && tiktokChars(adText) > 100) {
        adText = Array.from(adText).slice(0, -1).join("").trimEnd();
      }
      if (!adText) {
        throw new AdIntelligenceContractError(
          "TikTok Ad Text fehlt nach der Formatbereinigung.",
        );
      }
      return {
        platform: "tiktok",
        adText,
        displayName: requiredAndTruncated(
          context.brandName,
          "TikTok Display Name",
          1,
          40,
        ),
        ctaIntent: value.copy.cta,
        videoHook: value.copy.video_hook,
        voiceover: value.copy.voiceover,
        aspectRatio: "9:16",
        aiGeneratedContentDisclosureRequired: true,
      };
    }
  }
}
