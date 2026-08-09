/**
 * Vercel Express entrypoint.
 * Must import `express` in this file so Vercel can detect the framework.
 * Local development continues via `pnpm dev` → server/_core/index.ts.
 */
import "dotenv/config";
import express from "express";
import { createApp } from "./server/_core/createApp";

// Keep the express import live for Vercel framework detection.
void express;

const app = createApp({ serveFrontend: true });

export default app;
