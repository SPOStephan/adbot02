import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const migrationsDirectory = join(projectRoot, "supabase", "migrations");
const bootstrapPath = join(scriptsDirectory, "bootstrap-local-supabase.sql");
const regressionPath = join(scriptsDirectory, "test-meta-write-control-plane.sql");
const creativeRegressionPath = join(
  scriptsDirectory,
  "test-meta-creative-assets.sql",
);
const plannerRegressionPath = join(
  scriptsDirectory,
  "test-meta-budget-planner.sql",
);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, PGTZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error([
        `${basename(command)} failed with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n")));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local PostgreSQL test port"));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "adbot02-control-plane-"));
const dataDirectory = join(temporaryRoot, "postgres");
const socketDirectory = join(temporaryRoot, "socket");
const logPath = join(temporaryRoot, "postgres.log");
let pgCtlPath;
let serverStarted = false;

try {
  const { stdout: bindirOutput } = await run("pg_config", ["--bindir"]);
  const postgresBin = bindirOutput.trim();
  if (!postgresBin) {
    throw new Error("pg_config returned no PostgreSQL binary directory");
  }

  const initdbPath = join(postgresBin, "initdb");
  pgCtlPath = join(postgresBin, "pg_ctl");
  const psqlPath = join(postgresBin, "psql");
  const port = await getFreePort();
  await mkdir(socketDirectory, { recursive: true });

  await run(initdbPath, [
    "--pgdata", dataDirectory,
    "--username", "adbot_test",
    "--auth", "trust",
    "--no-locale",
    "--encoding", "UTF8",
  ]);

  await run(pgCtlPath, [
    "--pgdata", dataDirectory,
    "--log", logPath,
    "--options", `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
    "--wait",
    "start",
  ]);
  serverStarted = true;

  const psqlBase = [
    "--no-psqlrc",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--username", "adbot_test",
    "--dbname", "postgres",
    "--set", "ON_ERROR_STOP=1",
  ];

  await run(psqlPath, [...psqlBase, "--file", bootstrapPath]);

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  if (migrationNames.length === 0) {
    throw new Error("No Supabase migrations were found");
  }

  for (const migrationName of migrationNames) {
    try {
      await run(psqlPath, [
        ...psqlBase,
        "--file", join(migrationsDirectory, migrationName),
      ]);
    } catch (error) {
      throw new Error(`Migration ${migrationName} failed\n${error.message}`);
    }
  }

  const { stdout } = await run(psqlPath, [
    ...psqlBase,
    "--file", regressionPath,
  ]);

  if (!stdout.includes("Meta Write Control Plane migration checks passed")) {
    throw new Error("Control Plane regression did not emit its success marker");
  }

  const { stdout: creativeStdout } = await run(psqlPath, [
    ...psqlBase,
    "--file", creativeRegressionPath,
  ]);
  if (!creativeStdout.includes("Meta Creative Asset migration checks passed")) {
    throw new Error("Creative Asset regression did not emit its success marker");
  }

  const { stdout: plannerStdout } = await run(psqlPath, [
    ...psqlBase,
    "--file", plannerRegressionPath,
  ]);
  if (!plannerStdout.includes("Meta Budget Planner migration checks passed")) {
    throw new Error("Budget Planner regression did not emit its success marker");
  }

  console.log(
    "Meta Write Control Plane, Creative Asset and Budget Planner checks passed on a fresh PostgreSQL cluster",
  );
} finally {
  if (serverStarted && pgCtlPath) {
    await run(pgCtlPath, [
      "--pgdata", dataDirectory,
      "--wait",
      "--mode", "fast",
      "stop",
    ]).catch(() => {});
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
