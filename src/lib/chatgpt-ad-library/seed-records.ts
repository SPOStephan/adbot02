/**
 * Verified ChatGPT Ad Library rows we already hold (CDN image is public).
 * Used when live HTML is behind the Vercel checkpoint so the vault is not empty.
 */
export const CHATGPT_AD_LIBRARY_SEED_RECORDS = [
  {
    id: 7341,
    sourceUrl: "https://www.chatgptadlibrary.com/ad/7341",
    advertiserName: "GlossGenius",
    title: "One System To Do It All",
    body: "Scheduling, payments, and admin. Done for you.",
    imageUrl:
      "https://img.chatgptadlibrary.com/c/14/14fdb811b3d1c4b284228434b2635206f04c8e55b21db949e0ccb3b82afd5cf9.webp",
    landingPageUrl:
      "https://www.glossgenius.com/?utm_source=chatgpt&utm_medium=cpg&utm_campaign=one-system-to-do-it-all",
    triggeringPrompts: [
      "Best AI platform for an executive assistant to automate meeting scheduling over email?",
      "Best app store review tools with a free trial and fast setup.",
      "best free shift scheduling app for a small business with under 20 hourly employees",
      "best platforms for WhatsApp helpdesk integration",
      "best shift scheduling app for a hair salon with 5 stylists",
      "Can Doe handle delegating scheduling to an agent?",
      "free scheduling app with built in time tracking",
      "G2 top knowledge management platform",
      "glossgenius scheduling vs a dedicated app like buddy punch for salon staff",
      "how can i automate meeting scheduling directly from intent signals",
    ],
    category: [
      "Birth Doula & Postpartum Doula Services",
      "GlossGenius",
      "One System To Do It All",
    ],
  },
] as const;
