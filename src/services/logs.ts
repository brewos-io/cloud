/**
 * Log Service
 *
 * Captures and stores server logs for admin viewing.
 * Maintains an in-memory circular buffer of recent logs.
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

// Circular buffer for logs (keeps last 10,000 entries)
const MAX_LOGS = 10000;
const logs: LogEntry[] = [];
let logIdCounter = 0;

/**
 * Add a log entry
 */
export function addLog(
  level: LogLevel,
  message: string,
  source?: string,
  metadata?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    id: `log-${++logIdCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
    metadata,
  };

  logs.push(entry);

  // Remove oldest entries if we exceed max
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
}

/**
 * Get logs with filtering and pagination
 */
export function getLogs(options: {
  level?: LogLevel;
  source?: string;
  search?: string;
  limit?: number;
  beforeId?: string;
}): {
  logs: LogEntry[];
  hasMore: boolean;
  total: number;
} {
  let filtered = [...logs];

  // Filter by level
  if (options.level) {
    filtered = filtered.filter((log) => log.level === options.level);
  }

  // Filter by source
  if (options.source) {
    filtered = filtered.filter((log) => log.source === options.source);
  }

  // Search in message
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter(
      (log) =>
        log.message.toLowerCase().includes(searchLower) ||
        (log.source && log.source.toLowerCase().includes(searchLower))
    );
  }

  // Get logs before a specific ID (for pagination)
  if (options.beforeId) {
    const beforeIndex = filtered.findIndex((log) => log.id === options.beforeId);
    if (beforeIndex >= 0) {
      filtered = filtered.slice(0, beforeIndex);
    }
  }

  // Reverse to show newest first
  filtered.reverse();

  const limit = options.limit || 100;
  const hasMore = filtered.length > limit;
  const paginated = filtered.slice(0, limit);

  return {
    logs: paginated,
    hasMore,
    total: filtered.length,
  };
}

/**
 * Get unique log sources
 */
export function getLogSources(): string[] {
  const sources = new Set<string>();
  logs.forEach((log) => {
    if (log.source) {
      sources.add(log.source);
    }
  });
  return Array.from(sources).sort();
}

/**
 * Clear all logs
 */
export function clearLogs(): void {
  logs.length = 0;
}

/**
 * Get log statistics
 */
export function getLogStats(): {
  total: number;
  byLevel: Record<LogLevel, number>;
  bySource: Record<string, number>;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
} {
  const byLevel: Record<LogLevel, number> = {
    info: 0,
    warn: 0,
    error: 0,
    debug: 0,
  };

  const bySource: Record<string, number> = {};

  let oldestTimestamp: string | null = null;
  let newestTimestamp: string | null = null;

  logs.forEach((log) => {
    byLevel[log.level]++;
    if (log.source) {
      bySource[log.source] = (bySource[log.source] || 0) + 1;
    }
    if (!oldestTimestamp || log.timestamp < oldestTimestamp) {
      oldestTimestamp = log.timestamp;
    }
    if (!newestTimestamp || log.timestamp > newestTimestamp) {
      newestTimestamp = log.timestamp;
    }
  });

  return {
    total: logs.length,
    byLevel,
    bySource,
    oldestTimestamp,
    newestTimestamp,
  };
}

