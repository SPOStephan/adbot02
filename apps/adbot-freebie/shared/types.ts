export type ConfirmationMode = "doi" | "otp";

export type FreebieMetaTracking = {
  enabled: boolean;
  pixelId: string;
  eventName: string;
};

export type MediaAsset = {
  id: string;
  ownerUserId: string | null;
  filename: string;
  contentType: string;
  byteSize: number;
  bunnyPath: string;
  cdnUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FreebieOffer = {
  id: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  slug: string;
  title: string;
  description: string;
  confirmationMode: ConfirmationMode;
  mediaAssetId: string | null;
  isPublished: boolean;
  metaTracking: FreebieMetaTracking;
  createdAt: string;
  updatedAt: string;
};

export const defaultFreebieMetaTracking: FreebieMetaTracking = {
  enabled: false,
  pixelId: "",
  eventName: "Lead",
};

export type FreebieLeadStatus =
  | "pending"
  | "confirmed"
  | "delivered"
  | "expired";

export type FreebieLead = {
  id: string;
  offerId: string;
  email: string;
  status: FreebieLeadStatus;
  confirmationMode: ConfirmationMode;
  doiTokenHash: string | null;
  otpHash: string | null;
  otpExpiresAt: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};
