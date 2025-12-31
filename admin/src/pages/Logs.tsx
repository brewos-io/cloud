import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Play,
  Pause,
  Filter,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { LogEntry, LogLevel, LogSourcesResponse, LogStats } from "../lib/types";

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds for new logs
const MAX_LOGS_DISPLAY = 1000; // Max logs to display in UI

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastLogId, setLastLogId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Load logs
  const loadLogs = useCallback(
    async (append = false) => {
      try {
        if (!append) setLoading(true);

        const result = await api.getLogs({
          level: levelFilter !== "all" ? levelFilter : undefined,
          source: sourceFilter !== "all" ? sourceFilter : undefined,
          search: searchQuery || undefined,
          limit: 100,
          beforeId: append && lastLogId ? lastLogId : undefined,
        });

        if (append) {
          setLogs((prev) => [...prev, ...result.logs]);
        } else {
          setLogs(result.logs);
          if (result.logs.length > 0) {
            setLastLogId(result.logs[result.logs.length - 1].id);
          }
        }
        setHasMore(result.hasMore);
      } catch (error) {
        console.error("Failed to load logs:", error);
        if (error instanceof ApiError && error.status === 401) {
          // Session expired, will be handled by API client
        }
      } finally {
        setLoading(false);
      }
    },
    [levelFilter, sourceFilter, searchQuery, lastLogId]
  );

  // Load sources
  const loadSources = useCallback(async () => {
    try {
      const result = await api.getLogSources();
      setSources(result.sources);
    } catch (error) {
      console.error("Failed to load log sources:", error);
    }
  }, []);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const stats = await api.getLogStats();
      setStats(stats);
    } catch (error) {
      console.error("Failed to load log stats:", error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadLogs();
    loadSources();
    loadStats();
  }, [loadLogs, loadSources, loadStats]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadLogs();
      loadStats();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [autoRefresh, loadLogs, loadStats]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!logsContainerRef.current) return;
    const container = logsContainerRef.current;
    const isAtBottom =
      container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
    setAutoScroll(isAtBottom);
  };

  // Filter logs
  const filteredLogs = logs.slice(0, MAX_LOGS_DISPLAY);

  // Export logs
  const exportLogs = () => {
    const content = filteredLogs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${
            log.source ? `[${log.source}]` : ""
          } ${log.message}`
      )
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `brewos-logs-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Clear logs
  const handleClearLogs = async () => {
    if (!confirm("Are you sure you want to clear all logs? This cannot be undone.")) {
      return;
    }

    try {
      await api.clearLogs();
      setLogs([]);
      setLastLogId(null);
      loadStats();
    } catch (error) {
      if (error instanceof ApiError) {
        alert(error.message);
      }
    }
  };

  // Load more logs
  const loadMore = () => {
    if (hasMore && !loading) {
      loadLogs(true);
    }
  };

  function getLevelIcon(level: LogLevel) {
    switch (level) {
      case "error":
        return <AlertCircle className="w-4 h-4 text-admin-danger" />;
      case "warn":
        return <AlertTriangle className="w-4 h-4 text-admin-warning" />;
      case "debug":
        return <Bug className="w-4 h-4 text-admin-text-secondary" />;
      default:
        return <Info className="w-4 h-4 text-admin-accent" />;
    }
  }

  function getLevelClass(level: LogLevel) {
    switch (level) {
      case "error":
        return "text-admin-danger";
      case "warn":
        return "text-admin-warning";
      case "debug":
        return "text-admin-text-secondary";
      default:
        return "text-admin-accent";
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) {
      return "Just now";
    }
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}m ago`;
    }
    if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}h ago`;
    }
    return date.toLocaleString();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-admin-text flex items-center gap-3">
              <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-admin-accent" />
              Server Logs
            </h1>
            <p className="text-admin-text-secondary mt-1 text-sm sm:text-base">
              Real-time server logs and activity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`admin-button flex items-center gap-2 ${
                autoRefresh ? "bg-admin-accent" : ""
              }`}
              title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
            >
              {autoRefresh ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {autoRefresh ? "Pause" : "Resume"}
            </button>
            <button
              onClick={() => loadLogs()}
              className="admin-button flex items-center gap-2"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={exportLogs}
              className="admin-button flex items-center gap-2"
              disabled={filteredLogs.length === 0}
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <button
              onClick={handleClearLogs}
              className="admin-button flex items-center gap-2 text-admin-danger hover:bg-admin-danger/10"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="bg-admin-surface border border-admin-border rounded-lg px-3 py-2">
              <span className="text-admin-text-secondary">Total: </span>
              <span className="font-medium text-admin-text">{stats.total.toLocaleString()}</span>
            </div>
            <div className="bg-admin-surface border border-admin-border rounded-lg px-3 py-2">
              <span className="text-admin-text-secondary">Errors: </span>
              <span className="font-medium text-admin-danger">
                {stats.byLevel.error.toLocaleString()}
              </span>
            </div>
            <div className="bg-admin-surface border border-admin-border rounded-lg px-3 py-2">
              <span className="text-admin-text-secondary">Warnings: </span>
              <span className="font-medium text-admin-warning">
                {stats.byLevel.warn.toLocaleString()}
              </span>
            </div>
            {stats.oldestTimestamp && (
              <div className="bg-admin-surface border border-admin-border rounded-lg px-3 py-2">
                <span className="text-admin-text-secondary">Oldest: </span>
                <span className="font-medium text-admin-text">
                  {new Date(stats.oldestTimestamp).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-admin-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="admin-input pl-10 w-full"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-admin-text-secondary hover:text-admin-text"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel | "all")}
            className="admin-input"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
            <option value="debug">Debug</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="admin-input"
          >
            <option value="all">All Sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Logs */}
      <div className="admin-card p-0 overflow-hidden">
        <div
          ref={logsContainerRef}
          onScroll={handleScroll}
          className="h-[600px] overflow-y-auto font-mono text-sm"
        >
          {loading && logs.length === 0 ? (
            <div className="text-center py-8 text-admin-text-secondary">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <p className="text-admin-text-secondary text-center py-8">No logs to display</p>
          ) : (
            <>
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 py-2 px-4 hover:bg-admin-hover transition-colors border-b border-admin-border last:border-b-0"
                >
                  <span className="text-admin-text-secondary text-xs whitespace-nowrap min-w-[100px]">
                    {formatTimestamp(log.timestamp)}
                  </span>
                  {getLevelIcon(log.level)}
                  {log.source && (
                    <span className="text-admin-text-secondary text-xs font-semibold min-w-[80px]">
                      [{log.source}]
                    </span>
                  )}
                  <span className={`flex-1 ${getLevelClass(log.level)} break-words`}>
                    {log.message}
                  </span>
                </div>
              ))}
              {hasMore && (
                <div className="text-center py-4">
                  <button
                    onClick={loadMore}
                    className="admin-button"
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load More"}
                  </button>
                </div>
              )}
              {filteredLogs.length >= MAX_LOGS_DISPLAY && (
                <div className="text-center py-4 text-admin-text-secondary text-sm">
                  Showing first {MAX_LOGS_DISPLAY} logs. Use filters to narrow results.
                </div>
              )}
              <div ref={logsEndRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
