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
        <div className="funnel-canvas">
          <main className="funnel-main">
            <section className="funnel-step">
              <p className="funnel-eyebrow">Adbot Freebie</p>
              <h1>Seite nicht gefunden.</h1>
            </section>
          </main>
        </div>
      </Route>
    </Switch>
  );
}
