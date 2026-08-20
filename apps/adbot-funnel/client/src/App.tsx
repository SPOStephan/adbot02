import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Funnel from "./pages/Funnel";
import FunnelImprint from "./pages/FunnelImprint";
import RootImprint from "./pages/RootImprint";

const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const FunnelLibrary = lazy(() => import("./pages/admin/FunnelLibrary"));
const FunnelEditor = lazy(() => import("./pages/admin/FunnelEditor"));
const Applications = lazy(() => import("./pages/admin/Applications"));
const ApplicationDetail = lazy(() => import("./pages/admin/ApplicationDetail"));
const Settings = lazy(() => import("./pages/admin/Settings"));

function FunnelLibraryRoute() {
  return <DashboardLayout><FunnelLibrary /></DashboardLayout>;
}

function EditorRoute() {
  return <DashboardLayout><FunnelEditor /></DashboardLayout>;
}

function ApplicationsRoute() {
  return <DashboardLayout><Applications /></DashboardLayout>;
}

function ApplicationDetailRoute() {
  return <DashboardLayout><ApplicationDetail /></DashboardLayout>;
}

function SettingsRoute() {
  return <DashboardLayout><Settings /></DashboardLayout>;
}

function RouteLoading() {
  return <div className="grid min-h-screen place-items-center" role="status" aria-live="polite"><span className="text-sm text-muted-foreground">Bereich wird geladen …</span></div>;
}

function LegacyAdminRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation("/admin", { replace: true }), [setLocation]);
  return <RouteLoading />;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/impressum"} component={RootImprint} />
      <Route path={"/f/:slug/impressum"} component={FunnelImprint} />
      <Route path={"/f/:slug"} component={Funnel} />
      <Route path={"/admin/funnels/:id/editor"} component={EditorRoute} />
      <Route path={"/admin/funnels/:funnelId/applications/:id"} component={ApplicationDetailRoute} />
      <Route path={"/admin/funnels/:id/applications"} component={ApplicationsRoute} />
      <Route path={"/admin/funnels/:id/settings"} component={SettingsRoute} />
      <Route path={"/admin/editor"} component={LegacyAdminRedirect} />
      <Route path={"/admin/applications/:id"} component={ApplicationDetailRoute} />
      <Route path={"/admin/applications"} component={ApplicationsRoute} />
      <Route path={"/admin/settings"} component={LegacyAdminRedirect} />
      <Route path={"/admin"} component={FunnelLibraryRoute} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<RouteLoading />}><Router /></Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
