import "server-only";

import { MetaGraphError, revokeMetaAuthorization } from "./client";
import { decryptAccessToken } from "./crypto";
import { createAdminClient } from "../supabase/admin";

type StoredMetaAuthorization = {
  id: string;
  account_id: string | null;
  meta_user_id: string | null;
  access_token_encrypted: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
};

export type MetaAuthorizationResetResult = {
  hadStoredAuthorization: boolean;
  authorizationReset: boolean;
};

function storedAccessToken(
  authorization: StoredMetaAuthorization,
  tokenEncryptionKey: string,
): string | null {
  if (
    !authorization.access_token_encrypted
    || !authorization.token_iv
    || !authorization.token_auth_tag
  ) {
    return null;
  }

  return decryptAccessToken(
    {
      ciphertext: authorization.access_token_encrypted,
      iv: authorization.token_iv,
      authTag: authorization.token_auth_tag,
    },
    tokenEncryptionKey,
  );
}

export async function clearStoredMetaConnectionForReauthorization(
  userId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc(
    "reset_meta_connection_for_reauthorization",
    { p_user_id: userId },
  );

  if (error) {
    throw new Error("meta_connection_reset_failed");
  }
}

export async function resetStoredMetaAuthorization(input: {
  userId: string;
  appId: string;
  appSecret: string;
  tokenEncryptionKey: string;
}): Promise<MetaAuthorizationResetResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select(
      "id,account_id,meta_user_id,access_token_encrypted,token_iv,token_auth_tag",
    )
    .eq("user_id", input.userId)
    .eq("platform", "meta")
    .maybeSingle();

  if (error) {
    throw new Error("meta_connection_read_failed");
  }

  if (!data) {
    return {
      hadStoredAuthorization: false,
      authorizationReset: false,
    };
  }

  const authorization = data as StoredMetaAuthorization;
  const metaUserId = authorization.meta_user_id ?? authorization.account_id;

  if (!metaUserId) {
    throw new Error("meta_authorization_identity_missing");
  }

  const userAccessToken = storedAccessToken(
    authorization,
    input.tokenEncryptionKey,
  );
  const appAccessToken = `${input.appId}|${input.appSecret}`;

  try {
    await revokeMetaAuthorization({
      userId: metaUserId,
      accessToken: userAccessToken ?? appAccessToken,
      appSecret: input.appSecret,
    });
  } catch (error) {
    if (!userAccessToken || !(error instanceof MetaGraphError)) {
      throw error;
    }

    await revokeMetaAuthorization({
      userId: metaUserId,
      accessToken: appAccessToken,
      appSecret: input.appSecret,
    });
  }

  await clearStoredMetaConnectionForReauthorization(input.userId);

  return {
    hadStoredAuthorization: true,
    authorizationReset: true,
  };
}
