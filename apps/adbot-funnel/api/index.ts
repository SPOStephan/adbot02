/**
 * Vercel Serverless entry (api/* + rewrite).
 * More reliable than Express zero-config for this Vite+Express hybrid.
 */
import "dotenv/config";
import { createApp } from "../server/_core/createApp";

export default createApp({ serveFrontend: true });
