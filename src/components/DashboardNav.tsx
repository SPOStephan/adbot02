"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, type LucideIcon } from "lucide-react";

import {
  getDashboardNavigation,
  isDashboardNavActive,
  type DashboardNavItem,
} from "@/lib/dashboard/navigation";

type DashboardNavProps = {
  isAdmin: boolean;
};

function NavLinkContent({
  label,
  Icon,
}: {
  label: string;
  Icon: LucideIcon;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      <Icon className={`size-5 ${pending ? "animate-pulse" : ""}`} />
      <span className="flex-1">{label}</span>
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full bg-blue-500 transition-opacity duration-100 ${
          pending ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

function NavItem({
  item,
  pathname,
}: {
  item: DashboardNavItem;
  pathname: string;
}) {
  const { label, icon: Icon, href, external } = item;
  const active = isDashboardNavActive(pathname, item);

  if (!href) {
    return (
      <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400">
        <Icon className="size-5" />
        {label}
      </span>
    );
  }

  if (external) {
    return (
      <a
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
          active
            ? "bg-blue-50 text-blue-700"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
        }`}
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        <Icon className="size-5" />
        <span className="flex-1">{label}</span>
        <ExternalLink aria-hidden="true" className="size-3.5 opacity-60" />
      </a>
    );
  }

  return (
    <Link
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
      }`}
      href={href}
      prefetch
    >
      <NavLinkContent Icon={Icon} label={label} />
    </Link>
  );
}

export function DashboardNav({ isAdmin }: DashboardNavProps) {
  const pathname = usePathname() || "/dashboard";
  const navigation = getDashboardNavigation(isAdmin);

  return (
    <nav className="mt-10 space-y-1">
      {navigation.map((item) => (
        <NavItem item={item} key={item.label} pathname={pathname} />
      ))}
    </nav>
  );
}
