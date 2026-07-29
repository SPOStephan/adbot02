import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarClock,
  CalendarDays,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  HelpCircle,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";

import { ContentCandidatePreview } from "@/components/ContentCandidatePreview";
import { MetaSyncButton } from "@/components/MetaSyncButton";
import { PerformanceChart } from "@/components/PerformanceChart";
import { PlatformStatusCard } from "@/components/PlatformStatusCard";
import { SignOutButton } from "@/components/SignOutButton";
import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";

const navigation = [
  { label: "Übersicht", icon: LayoutDashboard, active: true },
  { label: "Kampagnen", icon: Megaphone },
  { label: "Creatives", icon: ImageIcon },
  { label: "Zielgruppen", icon: Target },
];

const metrics = [
  {
    label: "Werbeausgaben",
    value: "8.420 €",
    change: "+12,4 %",
    icon: WalletCards,
    color: "bg-blue-50 text-blue-600",
  },
  {
    label: "Generierte Leads",
    value: "1.284",
    change: "+18,7 %",
    icon: Users,
    color: "bg-violet-50 text-violet-600",
  },
  {
    label: "Kosten pro Lead",
    value: "6,56 €",
    change: "−5,2 %",
    icon: CircleDollarSign,
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    label: "Klickrate",
    value: "3,82 %",
    change: "+0,6 %",
    icon: MousePointerClick,
    color: "bg-amber-50 text-amber-600",
  },
];

type DashboardPageProps = {
  searchParams: Promise<{
    meta?: string | string[];
    meta_error?: string | string[];
  }>;
};

type MetaNotice = {
  tone: "success" | "error";
  title: string;
  message: string;
};

const META_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Die Meta-Verbindung wurde abgebrochen. Es wurden keine Änderungen gespeichert.",
  provider: "Meta konnte die Autorisierung nicht abschließen. Bitte versuche es erneut.",
  configuration: "Der Meta-Connector ist noch nicht vollständig konfiguriert.",
  missing_response: "Meta hat keine vollständige Antwort zurückgegeben. Bitte starte die Verbindung erneut.",
  invalid_state: "Die Sicherheitsprüfung ist abgelaufen oder ungültig. Bitte starte die Verbindung erneut.",
  scope_validation: "Die ausgewählten Berechtigungen entsprechen nicht dem sicheren Lesezugriff.",
  token_validation: "Die Meta-Verbindung konnte nicht sicher bestätigt werden. Bitte verbinde Meta erneut.",
  no_assets: "Bitte eine Facebook-Seite, das verbundene Instagram-Profil und ein Werbekonto auswählen.",
  storage: "Die Verbindung konnte nicht sicher gespeichert werden. Es wurde keine Verbindung aktiviert.",
  callback: "Die Meta-Antwort konnte nicht verarbeitet werden. Bitte starte die Verbindung erneut.",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getMetaNotice(
  meta: string | undefined,
  errorReason: string | undefined,
  metaConnected: boolean,
): MetaNotice | null {
  if (meta === "connected" && metaConnected) {
    return {
      tone: "success",
      title: "Meta wurde erfolgreich verbunden.",
      message:
        "Der Connector arbeitet mit Lesezugriff. Kampagnen können nicht erstellt oder verändert werden.",
    };
  }

  if (meta === "connected" && !metaConnected) {
    return {
      tone: "error",
      title: "Meta-Verbindung noch nicht bestätigt.",
      message:
        "Die Rückleitung war erfolgreich, aber es wurde kein aktiver Connector gefunden. Bitte starte die Verbindung erneut.",
    };
  }

  if (meta === "error" || errorReason) {
    return {
      tone: "error",
      title: "Meta konnte nicht verbunden werden.",
      message:
        META_ERROR_MESSAGES[errorReason ?? ""] ??
        "Die Verbindung wurde nicht abgeschlossen. Bitte starte den Vorgang erneut.",
    };
  }

  return null;
}

const SYNC_STATUS = {
  idle: {
    label: "Bereit für den ersten Abruf",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description: "Die Verbindung steht. Der sichere Ausgangsbestand kann jetzt eingelesen werden.",
  },
  reconnected: {
    label: "Wieder verbunden",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description: "Die Verbindung wurde erneuert. Der gespeicherte Ausgangsbestand bleibt erhalten.",
  },
  syncing: {
    label: "Abruf läuft",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description: "Facebook- und Instagram-Beiträge werden gerade abgeglichen.",
  },
  success: {
    label: "Aktuell",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description: "Der letzte Abruf wurde vollständig abgeschlossen.",
  },
  partial: {
    label: "Teilweise aktualisiert",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description: "Mindestens eine Quelle war kurzzeitig nicht erreichbar.",
  },
  error: {
    label: "Abruf wird wiederholt",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "Der automatische Abruf versucht es nach einer sicheren Pause erneut.",
  },
  rate_limited: {
    label: "Meta-Pause aktiv",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description: "Der Abruf pausiert automatisch, um Meta-Nutzungslimits einzuhalten.",
  },
  reconnect_required: {
    label: "Verbindung erneuern",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "Der Lesezugriff ist abgelaufen oder wurde von Meta widerrufen.",
  },
} as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Noch nicht ausgeführt";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Zeitpunkt nicht verfügbar";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

const platformVisuals = {
  meta: {
    accentClass: "bg-blue-50 text-blue-600",
    icon: Megaphone,
  },
  google: {
    accentClass: "bg-emerald-50 text-emerald-600",
    icon: Search,
  },
  tiktok: {
    accentClass: "bg-slate-100 text-slate-800",
    icon: Play,
  },
  pinterest: {
    accentClass: "bg-red-50 text-red-600",
    icon: Pin,
  },
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: connectedAccounts } = await supabase
    .from("platform_accounts")
    .select(
      "id, platform, account_name, connected_at, revoked_at, sync_status, sync_error_code, last_sync_started_at, last_synced_at, next_sync_at, baseline_completed_at, last_sync_seen_count, last_sync_new_count",
    )
    .eq("user_id", user.id);

  const platforms = getPlatformCatalog().map((platform) => {
    const account = connectedAccounts?.find(
      (item) => item.platform === platform.id,
    );

    const isMeta = platform.id === "meta";

    return {
      id: platform.id,
      name: platform.name,
      description: platform.description,
      status: account
        ? isMeta
          ? "Verbunden"
          : account.account_name
            ? `Verbunden: ${account.account_name}`
            : "Verbunden"
        : platform.configured
          ? "Bereit zur Verbindung"
          : "API-Zugang noch nicht hinterlegt",
      connected: Boolean(account),
      badge: isMeta && platform.configured ? "Nur Lesezugriff" : undefined,
      helperText: isMeta
        ? "Liest Anzeigen-, Seiten- und Instagram-Basisdaten. Keine Kampagnen-, Publishing- oder Messaging-Rechte."
        : undefined,
      actionHref:
        isMeta && platform.configured && !account
          ? "/api/connectors/meta/start"
          : undefined,
      actionLabel:
        isMeta && platform.configured && !account ? "Meta verbinden" : undefined,
      ...platformVisuals[platform.id],
    };
  });

  const hasConnectedPlatform = platforms.some((platform) => platform.connected);
  const metaAccount = connectedAccounts?.find(
    (account) => account.platform === "meta" && !account.revoked_at,
  );
  const metaConnected = Boolean(metaAccount?.connected_at);
  const [
    { data: metaAssets },
    { data: contentCandidates },
    { count: storedCandidateCount },
  ] = metaConnected && metaAccount
    ? await Promise.all([
          supabase
            .from("meta_assets")
            .select("id, asset_type, name, username, last_synced_at")
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .order("asset_type", { ascending: true }),
          supabase
            .from("meta_content_candidates")
            .select(
              "id, source, content_type, caption_excerpt, permalink_url, preview_url, published_at, first_seen_at",
            )
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .eq("is_new", true)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(8),
          supabase
            .from("meta_content_candidates")
            .select("id", { count: "exact", head: true })
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id),
        ])
      : [{ data: [] }, { data: [] }, { count: 0 }];
  const syncStatus = metaAccount?.sync_status ?? "idle";
  const syncInfo =
    syncStatus === "idle" && metaAccount?.baseline_completed_at
      ? SYNC_STATUS.reconnected
      : (SYNC_STATUS[syncStatus as keyof typeof SYNC_STATUS] ?? SYNC_STATUS.idle);
  const reconnectRequired = syncStatus === "reconnect_required";
  const pageAsset = metaAssets?.find(
    (asset) => asset.asset_type === "facebook_page",
  );
  const instagramAsset = metaAssets?.find(
    (asset) => asset.asset_type === "instagram_account",
  );
  const adAccountAsset = metaAssets?.find(
    (asset) => asset.asset_type === "ad_account",
  );
  const metaNotice = getMetaNotice(
    firstQueryValue(query.meta),
    firstQueryValue(query.meta_error),
    metaConnected,
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:flex-col">
        <Link className="flex items-center gap-3 px-2 font-extrabold" href="/dashboard">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <BarChart3 className="size-5" />
          </span>
          <span>AdPilot</span>
        </Link>

        <nav className="mt-10 space-y-1">
          {navigation.map(({ label, icon: Icon, active }) => (
            <span
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              }`}
              key={label}
            >
              <Icon className="size-5" />
              {label}
            </span>
          ))}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-5">
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <HelpCircle className="size-5" />
            Hilfe
          </span>
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <Settings className="size-5" />
            Einstellungen
          </span>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white">
                <BarChart3 className="size-4" />
              </span>
              <span className="font-extrabold">AdPilot</span>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <span className="hidden max-w-56 truncate text-sm text-slate-500 sm:block">
                {user.email}
              </span>
              <button
                aria-label="Benachrichtigungen"
                className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                type="button"
              >
                <Bell className="size-5" />
              </button>
              <SignOutButton />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:py-10">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  Demoansicht
                </span>
                <span className="text-xs text-slate-400">
                  {hasConnectedPlatform
                    ? "Mindestens eine Plattform ist verbunden"
                    : "Noch keine Werbekonten verbunden"}
                </span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Marketing-Übersicht</h1>
              <p className="mt-2 text-slate-500">
                Willkommen zurück. Hier entsteht dein kanalübergreifendes Cockpit.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm"
                type="button"
              >
                <CalendarDays className="size-4" />
                Letzte 30 Tage
              </button>
              <a
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                href="#plattformen"
              >
                <Plus className="size-4" />
                Plattform verbinden
              </a>
            </div>
          </div>

          {metaNotice ? (
            <section
              aria-live="polite"
              className={`mt-8 flex gap-3 rounded-2xl border p-4 sm:p-5 ${
                metaNotice.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-red-200 bg-red-50 text-red-950"
              }`}
              role={metaNotice.tone === "error" ? "alert" : "status"}
            >
              {metaNotice.tone === "success" ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
              )}
              <div>
                <p className="font-bold">{metaNotice.title}</p>
                <p className="mt-1 text-sm leading-6 opacity-80">{metaNotice.message}</p>
              </div>
            </section>
          ) : null}

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, change, icon: Icon, color }) => (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={label}>
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid size-10 place-items-center rounded-xl ${color}`}>
                    <Icon className="size-5" />
                  </span>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                    <TrendingUp className="size-3" />
                    {change}
                  </span>
                </div>
                <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
              </article>
            ))}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold">Lead-Entwicklung</p>
                  <p className="mt-1 text-sm text-slate-500">Beispielverlauf über alle Kanäle</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                  Demo
                </span>
              </div>
              <PerformanceChart />
            </article>

            <article className="overflow-hidden rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <span className="grid size-11 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-blue-300">
                KI-Assistent
              </p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight">
                Von einem Ziel zur fertigen Kampagne.
              </h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Im nächsten Produktinkrement erhält der Assistent Briefing, Budget und Freigaberegeln.
                Kampagnenstarts bleiben bis zur ausdrücklichen Freigabe gesperrt.
              </p>
              <button
                className="mt-8 w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 opacity-60"
                disabled
                type="button"
              >
                Assistent folgt im nächsten Schritt
              </button>
            </article>
          </section>

          <section className="mt-10" id="plattformen">
            <div>
              <h2 className="text-xl font-extrabold">Werbeplattformen</h2>
              <p className="mt-1 text-sm text-slate-500">
                Verbinde Konten direkt im Dashboard. Jede Integration zeigt ihren Freigabeumfang vor dem Start.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                <ShieldCheck className="size-3.5" />
                Meta startet ausschließlich mit dokumentiertem Lesezugriff
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {platforms.map(({ id, ...platform }) => (
                <PlatformStatusCard key={id} {...platform} />
              ))}
            </div>
          </section>

          {metaConnected && metaAccount ? (
            <section className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                      Meta Content Sync
                    </p>
                    <h2 className="mt-2 text-xl font-extrabold tracking-tight">
                      Beiträge sicher abrufen
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                      Adbot liest veröffentlichte Beiträge deiner ausgewählten Facebook-Seite und des verbundenen Instagram-Profils. Änderungen an Kampagnen oder Beiträgen sind technisch ausgeschlossen.
                    </p>
                  </div>
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${syncInfo.className}`}
                  >
                    {syncInfo.label}
                  </span>
                </div>
              </div>

              <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {syncInfo.description}
                  </p>
                  <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        <Clock3 className="size-4" />
                        Letzter Abruf
                      </dt>
                      <dd className="mt-2 text-sm font-bold text-slate-900">
                        {formatDateTime(metaAccount.last_synced_at)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        <CalendarClock className="size-4" />
                        Nächster Abruf
                      </dt>
                      <dd className="mt-2 text-sm font-bold text-slate-900">
                        {formatDateTime(metaAccount.next_sync_at)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Gesehen
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-slate-900">
                        {metaAccount.last_sync_seen_count ?? 0}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Neu erkannt
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-blue-700">
                        {metaAccount.last_sync_new_count ?? 0}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Gespeichert
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-slate-900">
                        {storedCandidateCount ?? 0}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                    {pageAsset ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5">
                        Facebook: {pageAsset.name}
                      </span>
                    ) : null}
                    {instagramAsset ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5">
                        Instagram:{" "}
                        {instagramAsset.username
                          ? `@${instagramAsset.username}`
                          : instagramAsset.name}
                      </span>
                    ) : null}
                    {adAccountAsset ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5">
                        Werbekonto: {adAccountAsset.name}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="lg:min-w-60">
                  {reconnectRequired ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-bold text-red-950">
                        Der Lesezugriff muss erneuert werden.
                      </p>
                      <Link
                        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                        href="/api/connectors/meta/start"
                        prefetch={false}
                      >
                        Meta neu verbinden
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>
                  ) : (
                    <MetaSyncButton
                      lastSyncStartedAt={metaAccount.last_sync_started_at ?? null}
                    />
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Automatisch einmal pro Stunde. Der manuelle Abruf ist nach 60 Sekunden erneut verfügbar.
                  </p>
                </div>
              </div>

              {!metaAccount.baseline_completed_at ? (
                <div className="mx-5 mb-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 sm:mx-6">
                  <span className="font-bold">Sicherer Ausgangsbestand:</span>{" "}
                  Beim ersten Abruf werden vorhandene Beiträge eingelesen, aber nicht als neu markiert. Erst später veröffentlichte Inhalte erscheinen als neue Kandidaten.
                </div>
              ) : null}
            </section>
          ) : null}

          {metaConnected ? (
            <section className="mt-10">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                    Beitragskandidaten
                  </p>
                  <h2 className="mt-2 text-xl font-extrabold tracking-tight">
                    Neu seit dem Ausgangsbestand
                  </h2>
                </div>
                <p className="max-w-xl text-sm leading-6 text-slate-500">
                  Nur minimale Beitragsdaten – es werden noch keine Werbeanzeigen erstellt oder verändert.
                </p>
              </div>

              {contentCandidates?.length ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {contentCandidates.map((candidate) => (
                    <article
                      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                      key={candidate.id}
                    >
                      <ContentCandidatePreview
                        contentType={candidate.content_type}
                        previewUrl={candidate.preview_url}
                        source={candidate.source}
                      />
                      <div className="flex min-h-52 flex-col p-5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            {candidate.source === "instagram" ? (
                              <Camera className="size-3.5" />
                            ) : (
                              <Megaphone className="size-3.5" />
                            )}
                            {candidate.source === "instagram"
                              ? "Instagram"
                              : "Facebook"}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">
                            {formatDateTime(
                              candidate.published_at ?? candidate.first_seen_at,
                            )}
                          </span>
                        </div>
                        <p className="mt-5 line-clamp-4 text-sm leading-6 text-slate-700">
                          {candidate.caption_excerpt ??
                            "Beitrag ohne verfügbaren Text"}
                        </p>
                        <div className="mt-auto pt-5">
                          {candidate.permalink_url ? (
                            <a
                              className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 transition hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                              href={candidate.permalink_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Originalbeitrag ansehen
                              <ExternalLink className="size-4" />
                            </a>
                          ) : (
                            <span className="text-sm font-semibold text-slate-400">
                              Kein öffentlicher Link verfügbar
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                  <RefreshCw className="mx-auto size-6 text-slate-400" />
                  <p className="mt-3 font-bold text-slate-900">
                    Noch keine neuen Beitragskandidaten
                  </p>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    Nach dem ersten Ausgangsbestand erscheinen hier Beiträge, die bei einem späteren manuellen oder stündlichen Abruf neu erkannt werden.
                  </p>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
