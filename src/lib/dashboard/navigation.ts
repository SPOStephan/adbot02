import {
  Camera,
  Crosshair,
  EyeOff,
  Filter,
  Gift,
  Globe2,
  ImageIcon,
  Images,
  LayoutDashboard,
  Megaphone,
  Rocket,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

import {
  createFreebieSsoEntryPath,
  createFunnelSsoEntryPath,
} from "@/lib/site-urls";

export type DashboardNavItem = {
  label: string;
  icon: LucideIcon;
  href: string | null;
  external?: boolean;
  /** When set, path is active if pathname equals or starts with this prefix. */
  match?: string;
};

export function getDashboardNavigation(isAdmin: boolean): DashboardNavItem[] {
  const items: DashboardNavItem[] = [
    {
      label: "Übersicht",
      icon: LayoutDashboard,
      href: "/dashboard",
      match: "/dashboard",
    },
    {
      label: "Kampagnen",
      icon: Megaphone,
      href: "/dashboard/kampagnen",
      match: "/dashboard/kampagnen",
    },
    {
      label: "Beiträge",
      icon: Camera,
      href: "/dashboard/beitraege",
      match: "/dashboard/beitraege",
    },
    {
      label: "Assistent",
      icon: Sparkles,
      href: "/dashboard/assistent",
      match: "/dashboard/assistent",
    },
    {
      label: "Funnel",
      icon: Filter,
      href: createFunnelSsoEntryPath(),
      external: true,
    },
    {
      label: "Freebie",
      icon: Gift,
      href: createFreebieSsoEntryPath(),
      external: true,
    },
    {
      label: "Tracking",
      icon: Crosshair,
      href: "/dashboard/tracking",
      match: "/dashboard/tracking",
    },
    {
      label: "Domains",
      icon: Globe2,
      href: "/dashboard/domains",
      match: "/dashboard/domains",
    },
    {
      label: "Creatives",
      icon: ImageIcon,
      href: "/dashboard/creatives",
      match: "/dashboard/creatives",
    },
    { label: "Zielgruppen", icon: Target, href: null },
    {
      label: "Autonomie",
      icon: ShieldCheck,
      href: "/dashboard/autonomie",
      match: "/dashboard/autonomie",
    },
    {
      label: "Traffic-Launch",
      icon: Rocket,
      href: "/dashboard/traffic-launch",
      match: "/dashboard/traffic-launch",
    },
  ];

  if (!isAdmin) {
    return items;
  }

  return [
    ...items,
    {
      label: "Branding",
      icon: Images,
      href: "/dashboard/branding",
      match: "/dashboard/branding",
    },
    {
      label: "Rechtliches",
      icon: Scale,
      href: "/dashboard/rechtliches",
      match: "/dashboard/rechtliches",
    },
    {
      label: "Inspiration",
      icon: EyeOff,
      href: "/dashboard/inspiration",
      match: "/dashboard/inspiration",
    },
  ];
}

export function isDashboardNavActive(
  pathname: string,
  item: DashboardNavItem,
): boolean {
  if (!item.href || item.external || !item.match) {
    return false;
  }
  if (item.match === "/dashboard") {
    return pathname === "/dashboard" || pathname === "/dashboard/";
  }
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
