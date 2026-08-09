import { Route, Switch } from "wouter";
import { AdminPage } from "./pages/AdminPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { HomePage } from "./pages/HomePage";
import { OfferPage } from "./pages/OfferPage";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/o/:slug" component={OfferPage} />
      <Route path="/confirm" component={ConfirmPage} />
      <Route>
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
          <div>
            <p className="brand text-4xl">Adbot Freebie</p>
            <p className="mt-3 text-[var(--muted)]">Seite nicht gefunden.</p>
          </div>
        </main>
      </Route>
    </Switch>
  );
}
