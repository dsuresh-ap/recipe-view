#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { exportNotes } from "./notes/exporter.js";
import { RecipeStore } from "./store.js";
import { createApp } from "./web/server.js";

const HELP = `recipe-view: show your Apple Notes recipes on Apple HomeView

Usage:
  recipe-view [serve]          Sync from Notes and serve the site (macOS)
  recipe-view serve --no-export
                               Serve an existing export folder (Docker, Linux)
  recipe-view export [--watch] Only sync from Notes into the export folder
  recipe-view install-agent [serve|export]
                               Run in the background at login (launchd)
  recipe-view uninstall-agent  Remove the background agent

Options (env var in brackets):
  --folder <name>    Notes folder to read            [RECIPE_VIEW_FOLDER]  default: Recipes
  --data <dir>       Export folder                   [RECIPE_VIEW_DATA]    default: ~/.recipe-view
  --port <n>         Port to listen on               [RECIPE_VIEW_PORT]    default: 4242
  --host <addr>      Address to bind                 [RECIPE_VIEW_HOST]    default: 0.0.0.0
  --interval <sec>   Seconds between Notes syncs     [RECIPE_VIEW_INTERVAL] default: 300
  --no-export        Don't read Notes; just serve    [RECIPE_VIEW_NO_EXPORT=1]
  --watch            With "export": keep syncing every --interval seconds
  -h, --help         Show this help
`;

const LABEL = "io.github.recipe-view";

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      folder: { type: "string" },
      data: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      interval: { type: "string" },
      "no-export": { type: "boolean" },
      watch: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const env = process.env;
  const opts = {
    folder: values.folder ?? env.RECIPE_VIEW_FOLDER ?? "Recipes",
    data: path.resolve(expandHome(values.data ?? env.RECIPE_VIEW_DATA ?? "~/.recipe-view")),
    port: Number(values.port ?? env.RECIPE_VIEW_PORT ?? 4242),
    host: values.host ?? env.RECIPE_VIEW_HOST ?? "0.0.0.0",
    interval: Math.max(15, Number(values.interval ?? env.RECIPE_VIEW_INTERVAL ?? 300)),
    noExport: values["no-export"] ?? /^(1|true|yes)$/i.test(env.RECIPE_VIEW_NO_EXPORT ?? ""),
    watch: values.watch ?? false,
  };

  const [command = "serve", ...rest] = positionals;
  switch (command) {
    case "serve":
      return runServe(opts);
    case "export":
      return runExport(opts);
    case "install-agent":
      return installAgent(rest[0] === "export" ? "export" : "serve", opts);
    case "uninstall-agent":
      return uninstallAgent();
    default:
      process.stderr.write(`Unknown command "${command}"\n\n${HELP}`);
      process.exitCode = 1;
  }
}

type Options = {
  folder: string;
  data: string;
  port: number;
  host: string;
  interval: number;
  noExport: boolean;
  watch: boolean;
};

let lastSkipped = "";

async function syncOnce(opts: Options): Promise<boolean> {
  try {
    const started = Date.now();
    const result = await exportNotes(opts.data, opts.folder);
    const skipped = result.skipped.join(", ");
    if (skipped && skipped !== lastSkipped) {
      log(`Skipped folders Notes wouldn't let us read: ${skipped}. Their notes aren't shown until Notes allows it.`);
    }
    lastSkipped = skipped;
    if (result.total === 0) {
      log(`No notes found in a Notes folder named "${opts.folder}". Check the name, or pass --folder.`);
    } else if (result.written || result.removed) {
      log(`Synced ${result.total} notes (${result.written} updated, ${result.removed} removed) in ${Date.now() - started} ms`);
    }
    return true;
  } catch (error) {
    log(`Sync failed: ${(error as Error).message}`);
    return false;
  }
}

function startSyncLoop(opts: Options): void {
  log(`Syncing Notes folder "${opts.folder}" into ${opts.data} every ${opts.interval}s`);
  void syncOnce(opts);
  setInterval(() => void syncOnce(opts), opts.interval * 1000).unref();
}

async function runExport(opts: Options): Promise<void> {
  if (!opts.watch) {
    const ok = await syncOnce(opts);
    if (ok) log(`Export folder: ${opts.data}`);
    process.exitCode = ok ? 0 : 1;
    return;
  }
  startSyncLoop(opts);
  // Keep the process alive; the interval is unref'd so the server can own shutdown.
  setInterval(() => {}, 1 << 30);
}

function lanUrls(port: number): string[] {
  const urls: string[] = [];
  if (process.platform === "darwin") {
    try {
      const name = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
      if (name) urls.push(`http://${name}.local:${port}`);
    } catch {
      // not fatal
    }
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

function runServe(opts: Options): void {
  mkdirSync(opts.data, { recursive: true });
  if (!opts.noExport) {
    if (process.platform === "darwin") {
      startSyncLoop(opts);
    } else {
      log("Not on macOS, so Notes can't be read here. Serving the export folder only (same as --no-export).");
    }
  }

  const store = new RecipeStore(opts.data);
  const app = createApp(store);
  const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, () => {
    log(`Serving recipes from ${opts.data}`);
    if (existsSync("/.dockerenv")) {
      log(`Open on your HomeView: http://<your-mac-name>.local:<published port> (port ${opts.port} inside the container)`);
      return;
    }
    const urls = lanUrls(opts.port);
    log(`Open on your HomeView: ${urls[0] ?? `http://<this-computer>:${opts.port}`}`);
    for (const url of urls.slice(1)) log(`                  or: ${url}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function plistEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function installAgent(mode: "serve" | "export", opts: Options): void {
  if (process.platform !== "darwin") {
    process.stderr.write("install-agent only works on macOS.\n");
    process.exitCode = 1;
    return;
  }
  const script = realpathSync(process.argv[1]!);
  if (script.includes(`${path.sep}_npx${path.sep}`)) {
    process.stderr.write(
      "Install recipe-view first (npm install -g recipe-view, or clone and build it); the npx cache can be cleared at any time.\n",
    );
    process.exitCode = 1;
    return;
  }

  const args = [process.execPath, script, mode];
  if (mode === "export") args.push("--watch");
  args.push("--folder", opts.folder, "--data", opts.data, "--interval", String(opts.interval));
  if (mode === "serve") args.push("--port", String(opts.port), "--host", opts.host);

  const logFile = path.join(os.homedir(), "Library", "Logs", "recipe-view.log");
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${plistEscape(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${plistEscape(logFile)}</string>
  <key>StandardErrorPath</key><string>${plistEscape(logFile)}</string>
</dict>
</plist>
`;
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(plistPath, plist);

  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // wasn't loaded
  }
  execFileSync("launchctl", ["bootstrap", domain, plistPath]);
  console.log(`Installed ${plistPath}
It runs "recipe-view ${mode}" now and at every login. Logs: ${logFile}

The first sync asks for permission to control Notes. If no prompt appears,
open System Settings → Privacy & Security → Automation and allow it there.`);
}

function uninstallAgent(): void {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // wasn't loaded
  }
  rmSync(plistPath, { force: true });
  console.log("Removed the recipe-view background agent.");
}

main();
