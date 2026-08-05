import "server-only";

import {
  asMetaAssetId,
  getMetaInstagramAccountAssets,
  getMetaPageAssets,
  type MetaInstagramAccountAsset,
} from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type InstagramConfirmCandidate = {
  id: string;
  username: string | null;
  name: string;
  pageId: string;
  pageName: string;
};

type ConnectorRow = {
  id: string;
  user_id: string;
  access_token_encrypted: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  expires_at: string | null;
  data_access_expires_at: string | null;
  page_ids: unknown;
  instagram_account_ids: unknown;
};

function hasExpired(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const id = asMetaAssetId(item);
    return id ? [id] : [];
  });
}

async function loadActiveConnector(userId: string): Promise<ConnectorRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_accounts")
    .select(
      "id,user_id,access_token_encrypted,token_iv,token_auth_tag,expires_at,data_access_expires_at,page_ids,instagram_account_ids",
    )
    .eq("user_id", userId)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("meta_not_connected");
  }

  return data as ConnectorRow;
}

export async function listInstagramConfirmCandidates(userId: string): Promise<{
  candidates: InstagramConfirmCandidate[];
  alreadySelectedIds: string[];
}> {
  const connector = await loadActiveConnector(userId);
  const alreadySelectedIds = asIdList(connector.instagram_account_ids);

  if (
    !connector.access_token_encrypted ||
    !connector.token_iv ||
    !connector.token_auth_tag ||
    hasExpired(connector.expires_at) ||
    hasExpired(connector.data_access_expires_at)
  ) {
    throw new Error("token_expired");
  }

  const env = getMetaSyncEnv();
  const accessToken = decryptAccessToken(
    {
      ciphertext: connector.access_token_encrypted,
      iv: connector.token_iv,
      authTag: connector.token_auth_tag,
    },
    env.tokenEncryptionKey,
  );
  const allowedPageIds = new Set(asIdList(connector.page_ids));
  const pagesResult = await getMetaPageAssets({
    accessToken,
    appSecret: env.appSecret,
    allowedPageIds: allowedPageIds.size ? allowedPageIds : undefined,
  });
  const pageLinked = pagesResult.pages.flatMap((page) =>
    page.instagramAccount
      ? [
          {
            pageId: page.id,
            pageName: page.name,
            account: page.instagramAccount,
          },
        ]
      : [],
  );

  if (!pageLinked.length) {
    return { candidates: [], alreadySelectedIds };
  }

  const verified = await getMetaInstagramAccountAssets({
    accessToken,
    appSecret: env.appSecret,
    allowedInstagramAccountIds: new Set(
      pageLinked.map((entry) => entry.account.id),
    ),
  });
  const verifiedById = new Map(
    verified.instagramAccounts.map((account) => [account.id, account]),
  );

  const candidates: InstagramConfirmCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of pageLinked) {
    const account = verifiedById.get(entry.account.id);
    if (!account || seen.has(account.id)) {
      continue;
    }

    seen.add(account.id);
    candidates.push({
      id: account.id,
      username: account.username,
      name: account.name,
      pageId: entry.pageId,
      pageName: entry.pageName,
    });
  }

  return { candidates, alreadySelectedIds };
}

export async function confirmInstagramAccounts(input: {
  userId: string;
  selectedIds: string[];
}): Promise<MetaInstagramAccountAsset[]> {
  const uniqueSelected = [
    ...new Set(
      input.selectedIds
        .map((id) => asMetaAssetId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!uniqueSelected.length) {
    throw new Error("empty_selection");
  }

  const { candidates } = await listInstagramConfirmCandidates(input.userId);
  const allowed = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const confirmed = uniqueSelected.flatMap((id) => {
    const candidate = allowed.get(id);
    return candidate
      ? [
          {
            id: candidate.id,
            name: candidate.name,
            username: candidate.username,
            pageId: candidate.pageId,
          },
        ]
      : [];
  });

  if (confirmed.length !== uniqueSelected.length) {
    throw new Error("invalid_selection");
  }

  const connector = await loadActiveConnector(input.userId);
  const admin = createAdminClient();
  const instagramAccountIds = confirmed.map((account) => account.id);
  const { error: accountError } = await admin
    .from("platform_accounts")
    .update({
      instagram_account_ids: instagramAccountIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connector.id)
    .eq("user_id", input.userId)
    .is("revoked_at", null);

  if (accountError) {
    throw new Error("storage");
  }

  const { error: deleteError } = await admin
    .from("meta_assets")
    .delete()
    .eq("platform_account_id", connector.id)
    .eq("user_id", input.userId)
    .eq("asset_type", "instagram_account");

  if (deleteError) {
    throw new Error("storage");
  }

  const { error: insertError } = await admin.from("meta_assets").insert(
    confirmed.map((account) => ({
      platform_account_id: connector.id,
      user_id: input.userId,
      asset_type: "instagram_account",
      meta_asset_id: account.id,
      parent_meta_asset_id: account.pageId,
      name: account.name,
      username: account.username,
    })),
  );

  if (insertError) {
    throw new Error("storage");
  }

  return confirmed.map((account) => ({
    id: account.id,
    name: account.name,
    username: account.username,
  }));
}
