import { trpc } from "@/lib/trpc";

export function useAuth() {
  const meQuery = trpc.auth.me.useQuery();
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await meQuery.refetch();
    },
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await meQuery.refetch();
    },
  });

  return {
    loading: meQuery.isLoading,
    user: meQuery.data ?? null,
    login: (email: string, password: string) =>
      loginMutation.mutateAsync({ email, password }),
    loginPending: loginMutation.isPending,
    loginError: loginMutation.error,
    logout: () => logoutMutation.mutateAsync(),
    logoutPending: logoutMutation.isPending,
  };
}
