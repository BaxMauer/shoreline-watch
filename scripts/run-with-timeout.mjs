#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const durationPattern = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

export function parseDuration(value) {
  const match = durationPattern.exec(value ?? "");
  if (!match) {
    throw new TypeError(`Invalid duration "${value}". Use values such as 500ms, 30s, 5m, or 1h.`);
  }

  const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  const milliseconds = Number(match[1]) * multipliers[match[2]];
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new RangeError(`Duration must be greater than zero: "${value}".`);
  }

  return Math.ceil(milliseconds);
}

function signalChild(child, signal) {
  if (!child.pid) return;

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export function runCommand(command, args, { timeoutMs, killAfterMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      stdio: "inherit",
    });
    let timedOut = false;
    let killTimer;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[timeout] ${command} exceeded ${timeoutMs} ms; sending SIGTERM.`);
      signalChild(child, "SIGTERM");
      killTimer = setTimeout(() => {
        console.error(`[timeout] ${command} did not stop after ${killAfterMs} ms; sending SIGKILL.`);
        signalChild(child, "SIGKILL");
      }, killAfterMs);
    }, timeoutMs);

    const forwardSignal = (signal) => signalChild(child, signal);
    const signalHandlers = new Map(
      ["SIGINT", "SIGTERM"].map((signal) => {
        const handler = () => forwardSignal(signal);
        process.on(signal, handler);
        return [signal, handler];
      }),
    );

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    };

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (timedOut) {
        resolve(124);
      } else if (code !== null) {
        resolve(code);
      } else {
        console.error(`[timeout] ${command} exited after signal ${signal}.`);
        resolve(128);
      }
    });
  });
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1 || separator === argv.length - 1) {
    throw new TypeError("Usage: run-with-timeout.mjs --timeout <duration> --kill-after <duration> -- <command> [args...]");
  }

  const options = new Map();
  for (let index = 0; index < separator; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new TypeError(`Invalid option sequence near "${name ?? ""}".`);
    }
    options.set(name, value);
  }

  if (!options.has("--timeout") || !options.has("--kill-after")) {
    throw new TypeError("Both --timeout and --kill-after are required.");
  }

  return {
    timeoutMs: parseDuration(options.get("--timeout")),
    killAfterMs: parseDuration(options.get("--kill-after")),
    command: argv[separator + 1],
    args: argv.slice(separator + 2),
  };
}

async function main() {
  const { command, args, timeoutMs, killAfterMs } = parseArguments(process.argv.slice(2));
  process.exitCode = await runCommand(command, args, { timeoutMs, killAfterMs });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 69;
  });
}
