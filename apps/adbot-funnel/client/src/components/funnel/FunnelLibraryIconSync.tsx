import { useEffect } from "react";
import { registerFunnelLibraryIcons } from "@shared/funnelIconRuntime";
import { trpc } from "@/lib/trpc";

export function FunnelLibraryIconSync() {
  const query = trpc.funnel.libraryIcons.useQuery();
  useEffect(() => {
    if (query.data) registerFunnelLibraryIcons(query.data);
  }, [query.data]);
  return null;
}
