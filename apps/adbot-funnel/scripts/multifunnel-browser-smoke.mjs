import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { SignJWT } from "jose";

const baseUrl = process.argv[2];
if (!baseUrl?.startsWith("https://")) throw new Error("Als erstes Argument wird die HTTPS-Vorschau-URL erwartet.");

const requiredEnv = ["JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Fehlende Umgebungsvariable: ${key}`);
}

const profileDir = `/tmp/social-recruiting-funnel-smoke-${Date.now()}`;
const debuggingPort = 9333;
const chromium = spawn("/usr/bin/chromium", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--remote-allow-origins=*",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function supabaseRequest(path, init = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase-Bereinigung fehlgeschlagen (${response.status}): ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function cleanupBrowserTestFunnels() {
  const candidates = await supabaseRequest("funnels?select=id,slug&slug=like.e2e-mehr-funnel-*");
  const testFunnels = candidates.filter(funnel => /^e2e-mehr-funnel-\d{8}(?:-kopie)?$/.test(funnel.slug));
  if (testFunnels.length === 0) return [];

  const ids = testFunnels.map(funnel => funnel.id);
  const applications = await supabaseRequest(`applications?select=id,funnel_id&funnel_id=in.(${ids.join(",")})&limit=1`);
  if (applications.length > 0) throw new Error("E2E-Testfunnel besitzen unerwartet Bewerbungen und werden deshalb nicht gelöscht.");

  await supabaseRequest(`funnels?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return testFunnels.map(funnel => funnel.slug);
}

async function waitForDebugEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Chromium benötigt beim ersten Start einige Millisekunden.
    }
    await sleep(100);
  }
  throw new Error("Chromium-Debug-Endpunkt wurde nicht rechtzeitig verfügbar.");
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const eventWaiters = new Map();
  let sequence = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      const waiter = eventWaiters.get(message.method)?.shift();
      if (waiter) waiter.resolve(message.params);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  async function send(method, params = {}, sessionId) {
    await ready;
    const id = ++sequence;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return response;
  }

  function once(method, timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      const waiters = eventWaiters.get(method) ?? [];
      const waiter = {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject,
      };
      const timeout = setTimeout(() => {
        const remaining = eventWaiters.get(method) ?? [];
        eventWaiters.set(method, remaining.filter(item => item !== waiter));
        reject(new Error(`Zeitüberschreitung beim CDP-Ereignis ${method}`));
      }, timeoutMs);
      waiters.push(waiter);
      eventWaiters.set(method, waiters);
    });
  }

  return { send, once, close: () => socket.close() };
}

async function main() {
  const { webSocketDebuggerUrl } = await waitForDebugEndpoint();
  const browser = createCdpClient(webSocketDebuggerUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => browser.send(method, params, sessionId);

  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Network.enable")]);

  const adminEmail = process.env.ADMIN_EMAIL;
  const token = await new SignJWT({
    email: adminEmail,
    name: process.env.ADMIN_NAME || "Adbot Admin",
    role: "admin",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`admin:${adminEmail}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

  const cookie = await send("Network.setCookie", {
    name: "app_session_id",
    value: token,
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: "None",
    expires: Math.floor(Date.now() / 1000) + 600,
  });
  if (!cookie.success) throw new Error("Der kurzlebige Admin-Testcookie konnte nicht gesetzt werden.");

  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser-Auswertung fehlgeschlagen.");
    return result.result.value;
  };

  const waitFor = async (expression, label, timeoutMs = 20_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return;
      await sleep(150);
    }
    const diagnosis = await evaluate(`({ href: location.href, readyState: document.readyState, body: document.body?.innerText?.slice(0, 1200) ?? "", rootHtml: document.getElementById("root")?.innerHTML?.slice(0, 1200) ?? "" })`);
    throw new Error(`Zeitüberschreitung: ${label}\n${JSON.stringify(diagnosis)}`);
  };

  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitFor(`document.readyState === "complete"`, `Seite ${path} laden`);
  };

  const clickButton = async text => {
    const clicked = await evaluate(`(() => { const target = [...document.querySelectorAll("button")].find(node => node.textContent?.trim().includes(${JSON.stringify(text)})); if (!target) return false; target.click(); return true; })()`);
    if (!clicked) throw new Error(`Button nicht gefunden: ${text}`);
  };

  const expectConfirmAndDismiss = async (expression, expectedMessage) => {
    const dialogPromise = browser.once("Page.javascriptDialogOpening");
    const actionPromise = evaluate(expression);
    const dialog = await dialogPromise;
    await send("Page.handleJavaScriptDialog", { accept: false });
    await actionPromise;
    if (!dialog.message?.includes(expectedMessage)) throw new Error(`Unerwarteter Bestätigungsdialog: ${dialog.message}`);
    return dialog.message;
  };

  const setInput = async (id, value) => {
    const changed = await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    if (!changed) throw new Error(`Eingabefeld nicht gefunden: ${id}`);
  };

  const openCardMenu = async title => {
    const opened = await evaluate(`(() => { const card = [...document.querySelectorAll("article")].find(node => node.querySelector("h2")?.textContent?.trim() === ${JSON.stringify(title)}); const button = card?.querySelector('button[aria-label^="Aktionen für"]'); if (!(button instanceof HTMLButtonElement)) return false; button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerType: "mouse" })); button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })); button.click(); return true; })()`);
    if (!opened) throw new Error(`Aktionsmenü nicht gefunden: ${title}`);
  };

  const clickMenuItem = async text => {
    await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(node => node.textContent?.includes(${JSON.stringify(text)}))`, `Menüpunkt ${text}`);
    const clicked = await evaluate(`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent?.includes(${JSON.stringify(text)})); if (!item) return false; item.click(); return true; })()`);
    if (!clicked) throw new Error(`Menüpunkt nicht klickbar: ${text}`);
  };

  const archive = async title => {
    await openCardMenu(title);
    await clickMenuItem("Archivieren");
    await waitFor(`Boolean(document.querySelector('[role="alertdialog"]'))`, `Archivierungsdialog für ${title}`);
    await waitFor(`Boolean(document.querySelector('[role="alertdialog"] [data-slot="alert-dialog-action"]')) || [...document.querySelectorAll('[role="alertdialog"] button')].some(node => node.textContent?.includes("Archivieren"))`, `Archivierungsbestätigung für ${title}`);
    const confirmed = await evaluate(`(() => { const dialog = document.querySelector('[role="alertdialog"]'); const button = dialog?.querySelector('[data-slot="alert-dialog-action"]') ?? [...(dialog?.querySelectorAll("button") ?? [])].find(node => node.textContent?.includes("Archivieren")); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()`);
    if (!confirmed) throw new Error(`Archivierung konnte nicht bestätigt werden: ${title}`);
    await waitFor(`[...document.querySelectorAll("article")].some(node => node.querySelector("h2")?.textContent?.trim() === ${JSON.stringify(title)} && node.textContent?.includes("Archiviert"))`, `Archivierungsstatus für ${title}`);
    await waitFor(`!document.querySelector('[role="alertdialog"]') && !document.querySelector('button[aria-busy="true"]')`, `abgeschlossene Archivierung für ${title}`);
  };

  const suffix = Date.now().toString().slice(-8);
  const title = `E2E Mehr-Funnel ${suffix}`;
  const slug = `e2e-mehr-funnel-${suffix}`;
  const copyTitle = `${title} Kopie`;
  const copySlug = `${slug}-kopie`;

  await navigate("/admin");
  await waitFor(`[...document.querySelectorAll("button")].some(node => node.textContent?.includes("Neuen Funnel erstellen"))`, "Funnel-Bibliothek");
  const staleTestFunnels = await evaluate(`[...document.querySelectorAll("article")].filter(node => node.querySelector("h2")?.textContent?.trim().startsWith("E2E Mehr-Funnel") && !node.textContent?.includes("Archiviert")).map(node => node.querySelector("h2").textContent.trim())`);
  for (const staleTitle of staleTestFunnels) await archive(staleTitle);
  await clickButton("Neuen Funnel erstellen");
  await waitFor(`Boolean(document.getElementById("new-funnel-title"))`, "Erstellungsdialog");
  await setInput("new-funnel-title", title);
  await setInput("new-funnel-slug", slug);
  await clickButton("Vorlage anlegen");
  await waitFor(`location.pathname.includes("/editor") && document.body.textContent.includes(${JSON.stringify(title)})`, "Editor des neuen Funnels");
  const createdPath = await evaluate("location.pathname");

  const editorOriginalName = await evaluate(`document.querySelector("section input:not([type=color])")?.value`);
  if (!editorOriginalName) throw new Error("Editierbarer Seitenname im Funnel-Editor nicht gefunden.");
  const editorSavedName = `${editorOriginalName} E2E`;
  const editorChanged = await evaluate(`(() => { const input = document.querySelector("section input:not([type=color])"); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ${JSON.stringify(editorSavedName)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!editorChanged) throw new Error("Editor-Teständerung konnte nicht gesetzt werden.");
  await waitFor(`document.body.textContent.includes("Ungespeicherte Änderungen")`, "Editor-Ungespeichert-Zustand");
  const editorConfirm = await expectConfirmAndDismiss(`(() => { const button = document.querySelector('button[aria-label="Zur Funnel-Bibliothek"]'); if (!(button instanceof HTMLButtonElement)) throw new Error("Editor-Rückbutton fehlt"); button.click(); return true; })()`, "Ungespeicherte Änderungen verwerfen?");
  await clickButton("Speichern");
  await waitFor(`!document.body.textContent.includes("Ungespeicherte Änderungen") && [...document.querySelectorAll("button")].some(node => node.textContent?.trim() === "Speichern" && node.disabled)`, "gespeicherter Editor-Zustand");

  await clickButton("Einstellungen");
  await waitFor(`location.pathname.includes("/settings") && Boolean(document.getElementById("notification-email"))`, "Funnel-Einstellungen");
  const settingsPath = await evaluate("location.pathname");
  const settingsEmail = `e2e-${suffix}@example.com`;
  await setInput("notification-email", settingsEmail);
  await waitFor(`document.body.textContent.includes("Ungespeicherte Änderungen")`, "Einstellungen-Ungespeichert-Zustand");
  const settingsConfirm = await expectConfirmAndDismiss(`(() => { const button = [...document.querySelectorAll("button")].find(node => node.textContent?.includes("Funnel-Bibliothek")); if (!(button instanceof HTMLButtonElement)) throw new Error("Einstellungen-Rückbutton fehlt"); button.click(); return true; })()`, "Ungespeicherte Einstellungen verwerfen?");
  await clickButton("Einstellungen speichern");
  await waitFor(`!document.body.textContent.includes("Ungespeicherte Änderungen") && [...document.querySelectorAll("button")].some(node => node.textContent?.trim() === "Einstellungen speichern" && node.disabled)`, "gespeicherter Einstellungen-Zustand");
  await navigate(settingsPath);
  await waitFor(`document.getElementById("notification-email")?.value === ${JSON.stringify(settingsEmail)}`, "persistierte Einstellungen nach Reload");

  await navigate("/admin");
  await waitFor(`[...document.querySelectorAll("article h2")].some(node => node.textContent?.trim() === ${JSON.stringify(title)})`, "neuer Funnel in Bibliothek");
  await openCardMenu(title);
  await clickMenuItem("Funnel kopieren");
  await waitFor(`Boolean(document.getElementById("duplicate-funnel-title"))`, "Kopierdialog");
  await setInput("duplicate-funnel-title", copyTitle);
  await setInput("duplicate-funnel-slug", copySlug);
  await clickButton("Funnel kopieren");
  await waitFor(`location.pathname.includes("/editor") && document.body.textContent.includes(${JSON.stringify(copyTitle)})`, "Editor der Funnel-Kopie");
  const copiedPath = await evaluate("location.pathname");

  await navigate("/admin");
  await waitFor(`[...document.querySelectorAll("article h2")].filter(node => [${JSON.stringify(title)}, ${JSON.stringify(copyTitle)}].includes(node.textContent?.trim())).length === 2`, "beide Testfunnel in Bibliothek");
  await archive(copyTitle);
  await archive(title);
  const removedTestFunnels = await cleanupBrowserTestFunnels();

  console.log(JSON.stringify({
    success: true,
    created: { title, slug, path: createdPath, editorSavedName, editorConfirm },
    settings: { path: settingsPath, notificationEmail: settingsEmail, settingsConfirm, persistedAfterReload: true },
    copied: { title: copyTitle, slug: copySlug, path: copiedPath },
    cleanup: { archived: [slug, copySlug], removed: removedTestFunnels },
  }));

  browser.close();
}

try {
  await main();
} finally {
  chromium.kill("SIGKILL");
  await sleep(250);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
