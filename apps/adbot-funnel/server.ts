/**
 * Optional Express-style entry for local tooling / future zero-config.
 * Production on Vercel uses `api/index.ts` + `vercel.json` rewrites.
 */
import "dotenv/config";
import express from "express";
import { createApp } from "./server/_core/createApp";

void express;

export default createApp({ serveFrontend: true });
