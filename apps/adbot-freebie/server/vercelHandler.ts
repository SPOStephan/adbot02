import { createApp } from "./_core/createApp";

/**
 * Vercel serverless entry.
 * Frontend/SPA is served by CDN + vercel.json rewrite to /index.html.
 * Express only handles /api/*.
 */
const app = createApp({ serveFrontend: false });

export default app;
