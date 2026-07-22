import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CircleDollarSign,
  HelpCircle,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Pin,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";

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

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: connectedAccounts } = await supabase
    .from("platform_accounts")
    .select("platform, account_name")
    .eq("user_id", user.id);

  const platforms = getPlatformCatalog().map((platform) => {
    const account = connectedAccounts?.find(
      (item) => item.platform === platform.id,
    );

    return {
      name: platform.name,
      description: platform.description,
      status: account
        ? account.account_name
          ? `Verbunden: ${account.account_name}`
          : "Verbunden"
        : platform.configured
          ? "Bereit zur Verbindung"
          : "API-Zugang noch nicht hinterlegt",
      connected: Boolean(account),
      ...platformVisuals[platform.id],
    };
  });

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
                <span className="text-xs text-slate-400">Noch keine Werbekonten verbunden</span>
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
                Technische Connectoren werden getrennt und schrittweise freigeschaltet.
              </p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {platforms.map((platform) => (
                <PlatformStatusCard key={platform.name} {...platform} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
