import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function arg(name, fallback) {
  const prefix = "--" + name + "=";
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const label = "com.solpient.research.daily";
const hour = Math.max(0, Math.min(23, Number(arg("hour", "6")) || 0));
const minute = Math.max(0, Math.min(59, Number(arg("minute", "30")) || 0));
const uninstall = process.argv.includes("--uninstall");
const uid = process.getuid?.();

if (!Number.isInteger(uid)) {
  throw new Error("launchd installer requires a macOS user context.");
}

const launchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgents, label + ".plist");
const logsDir = path.resolve("logs");
const stdoutPath = path.join(logsDir, "solpient-daily.out.log");
const stderrPath = path.join(logsDir, "solpient-daily.err.log");

function launchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      "launchctl " +
        args.join(" ") +
        " failed: " +
        (result.stderr || result.stdout || String(result.status)),
    );
  }
  return result;
}

if (uninstall) {
  launchctl(["bootout", "gui/" + uid, plistPath], { allowFailure: true });
  try {
    await fs.unlink(plistPath);
  } catch {}
  console.log("Removed " + label + ".");
  process.exit(0);
}

await fs.mkdir(launchAgents, { recursive: true });
await fs.mkdir(logsDir, { recursive: true });

const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const plist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '  <key>Label</key>',
  '  <string>' + label + '</string>',
  '',
  '  <key>ProgramArguments</key>',
  '  <array>',
  '    <string>' + xmlEscape(process.execPath) + '</string>',
  '    <string>' + xmlEscape(path.join(process.cwd(), "scripts", "run-solpient-daily.mjs")) + '</string>',
  '  </array>',
  '',
  '  <key>WorkingDirectory</key>',
  '  <string>' + xmlEscape(process.cwd()) + '</string>',
  '',
  '  <key>StartCalendarInterval</key>',
  '  <dict>',
  '    <key>Hour</key>',
  '    <integer>' + hour + '</integer>',
  '    <key>Minute</key>',
  '    <integer>' + minute + '</integer>',
  '  </dict>',
  '',
  '  <key>StandardOutPath</key>',
  '  <string>' + xmlEscape(stdoutPath) + '</string>',
  '  <key>StandardErrorPath</key>',
  '  <string>' + xmlEscape(stderrPath) + '</string>',
  '',
  '  <key>RunAtLoad</key>',
  '  <false/>',
  '</dict>',
  '</plist>',
  '',
].join("\n");

await fs.writeFile(plistPath, plist, "utf8");
launchctl(["bootout", "gui/" + uid, plistPath], { allowFailure: true });
launchctl(["bootstrap", "gui/" + uid, plistPath]);
launchctl(["enable", "gui/" + uid + "/" + label], { allowFailure: true });

console.log(JSON.stringify({
  installed: true,
  label,
  plist: plistPath,
  schedule: { hour, minute, timezone: "Mac local time" },
  command: process.execPath + " " + path.join(process.cwd(), "scripts", "run-solpient-daily.mjs"),
  stdout: stdoutPath,
  stderr: stderrPath,
}, null, 2));
