/**
 * Logger
 *
 * Wraps console methods to capture logs for admin viewing.
 * Logs are still output to console AND stored for admin access.
 */

import { addLog, type LogLevel } from "../services/logs.js";

// Extract source from stack trace (e.g., "[Device]", "[Auth]")
function extractSource(message: string): string | undefined {
  // Check if message starts with [Source] pattern
  const match = message.match(/^\[([^\]]+)\]/);
  if (match) {
    return match[1];
  }
  return undefined;
}

// Extract source from file path in stack trace
function extractSourceFromStack(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    // Look for our source files
    const lines = stack.split("\n");
    for (const line of lines) {
      // Match patterns like "at DeviceRelay.handleConnection" or "at /path/to/file.ts"
      const match = line.match(/at\s+(\w+)|at\s+.*\/([^/]+)\.(ts|js)/);
      if (match) {
        const source = match[1] || match[2];
        if (source && source !== "logger" && source !== "Object") {
          return source;
        }
      }
    }
  } catch {
    // Ignore errors in stack parsing
  }
  return undefined;
}

function logToStore(
  level: LogLevel,
  ...args: unknown[]
): void {
  // Convert arguments to string message
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
      }
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  // Extract source from message or stack
  const source = extractSource(message) || extractSourceFromStack();

  // Store log
  addLog(level, message, source);
}

// Wrap console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

// Override console methods
console.log = (...args: unknown[]) => {
  originalConsole.log(...args);
  logToStore("info", ...args);
};

console.info = (...args: unknown[]) => {
  originalConsole.info(...args);
  logToStore("info", ...args);
};

console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args);
  logToStore("warn", ...args);
};

console.error = (...args: unknown[]) => {
  originalConsole.error(...args);
  logToStore("error", ...args);
};

console.debug = (...args: unknown[]) => {
  originalConsole.debug(...args);
  logToStore("debug", ...args);
};

// Export original console for cases where we don't want logging
export { originalConsole };

