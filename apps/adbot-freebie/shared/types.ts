export type ConfirmationMode = "doi" | "otp";

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
  createdAt: string;
  updatedAt: string;
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
