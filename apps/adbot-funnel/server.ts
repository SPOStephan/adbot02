/**
 * Vercel Express entrypoint (detected as server.ts).
 * Local development continues to use `pnpm dev` → server/_core/index.ts.
 */
import "dotenv/config";
import { createApp } from "./server/_core/createApp";

const app = createApp({ serveFrontend: true });

export default app;
