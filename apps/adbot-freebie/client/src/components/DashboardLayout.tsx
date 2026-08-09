import { useAuth } from "@/_core/hooks/useAuth";
import { Gift, LayoutGrid, LogOut, PanelLeft } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "wouter";
import { AdminLoginForm } from "./AdminLoginForm";

const menuItems = [
  {
    icon: LayoutGrid,
    label: "Freebies",
    path: "/admin",
    matches: (location: string) =>
      location === "/admin" || location.startsWith("/admin/"),
  },
];

const SIDEBAR_WIDTH_KEY = "freebie-sidebar-width";
const DEFAULT_WIDTH = 280;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(false);
  const { loading, user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  const activeMenuItem = useMemo(
    () => menuItems.find(item => item.matches(location)),
    [location],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Lade Session…
      </div>
    );
  }

  if (!user) {
    return <AdminLoginForm />;
  }

  return (
    <div
      className="flex min-h-screen w-full bg-background"
      style={
        {
          "--sidebar-width": collapsed ? "3.5rem" : `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <a className="admin-skip-link" href="#admin-content">
        Zum Hauptinhalt springen
      </a>

      {!isMobile ? (
        <aside
          className="sticky top-0 flex h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          style={{ width: "var(--sidebar-width)" }}
        >
          <div className="flex h-16 items-center gap-3 px-3">
            <button
              aria-label={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setCollapsed(current => !current)}
              type="button"
            >
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            {!collapsed ? (
              <span className="truncate font-semibold tracking-tight">
                Adbot Freebie
              </span>
            ) : null}
          </div>

          <nav className="flex-1 px-2 py-1">
            <ul className="space-y-1">
              {menuItems.map(item => {
                const isActive = item.matches(location);
                return (
                  <li key={item.path}>
                    <button
                      aria-current={isActive ? "page" : undefined}
                      className={`flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm transition-colors ${
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "hover:bg-accent/70"
                      }`}
                      onClick={() => setLocation(item.path)}
                      type="button"
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      {!collapsed ? <span>{item.label}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-sidebar-border p-3">
            <div
              className={`flex items-center gap-3 rounded-lg px-1 py-1 ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-white text-xs font-medium">
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </span>
              {!collapsed ? (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-none">
                    {user.name || "-"}
                  </p>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {user.email || "-"}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              className={`mt-2 inline-flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-destructive transition-colors hover:bg-rose-50 ${
                collapsed ? "justify-center" : ""
              }`}
              onClick={() => void logout()}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed ? <span>Abmelden</span> : null}
            </button>
          </div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {isMobile ? (
          <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-[#0165c3]" />
              <span className="tracking-tight text-foreground">
                {activeMenuItem?.label ?? "Freebie"}
              </span>
            </div>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-destructive"
              onClick={() => void logout()}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              Abmelden
            </button>
          </div>
        ) : null}
        <main className="flex-1 p-4" id="admin-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}
