/**
 * Vercel Serverless entry (api/* + rewrite).
 * Must not import Vite/dev-only modules — that crashes the function.
 */
import "dotenv/config";
import { createApp } from "../server/_core/createApp";

const app = createApp({ serveFrontend: true });

export default app;
