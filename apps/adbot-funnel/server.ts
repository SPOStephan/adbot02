/**
 * Optional Express-style entry for local tooling.
 * Production on Vercel uses `api/index.js` (from vercelHandler) + vercel.json.
 */
import "dotenv/config";
import express from "express";
import { createApp } from "./server/_core/createApp";

void express;

export default createApp({ serveFrontend: false });
