"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { FeedbackLog, fetchLogs, getUserFriendlyError } from "@/lib/api";

const numberFormatter = new Intl.NumberFormat();
const RETENTION_DAYS = 7;

const STATUS_ICON: Record<FeedbackLog["status"], string> = {
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

type GroupedFeedbackLog = FeedbackLog & {
  count: number;
};

function groupSimilarLogs(logs: FeedbackLog[]) {
  const grouped = new Map<string, GroupedFeedbackLog>();

  for (const log of logs) {
    const key = `${log.title}|${log.status}|${log.action}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, { ...log, count: 1 });
      continue;
    }

    const existingTime = new Date(existing.created_at).getTime();
    const currentTime = new Date(log.created_at).getTime();
    const latestLog = currentTime > existingTime ? log : existing;

    grouped.set(key, {
      ...latestLog,
      count: existing.count + 1,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export default function LogsPage() {
  const [logs, setLogs] = useState<FeedbackLog[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackLog["status"]>("all");
  const [status, setStatus] = useState("Loading logs...");
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");

  useEffect(() => {
    fetchLogs()
      .then((data) => {
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const recentLogs = (data.logs || []).filter((log) => {
          const timestamp = new Date(log.created_at).getTime();
          return Number.isFinite(timestamp) && timestamp >= cutoff;
        });

        setLogs(recentLogs);
        setStatus(recentLogs.length ? "" : "No recent product feedback updates yet.");
      })
      .catch((error) => {
        setLogs([]);
        setStatus(getUserFriendlyError(error, "Unable to load feedback updates right now."));
        setStatusTone("error");
      });
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesStatus = statusFilter === "all" || log.status === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText = [log.title, log.description, log.action]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [logs, normalizedQuery, statusFilter]);

  const groupedLogs = useMemo(() => groupSimilarLogs(visibleLogs), [visibleLogs]);

  const summary = useMemo(() => {
    const total = logs.length;
    const success = logs.filter((log) => log.status === "success").length;
    const warnings = logs.filter((log) => log.status === "warning").length;
    const errors = logs.filter((log) => log.status === "error").length;
    const latest = logs[0]?.created_at || null;

    return {
      total,
      success,
      warnings,
      errors,
      latest,
    };
  }, [logs]);

  return (
    <div className="stack">
      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      <Card title="Feedback Insights" subtitle="Human-readable product updates from background automation">
        <div className="metrics-grid">
          <MetricCard label="Total Updates" value={numberFormatter.format(summary.total)} />
          <MetricCard label="Success" value={numberFormatter.format(summary.success)} />
          <MetricCard label="Warnings" value={numberFormatter.format(summary.warnings)} />
          <MetricCard label="Errors" value={numberFormatter.format(summary.errors)} />
        </div>

        <div className="toolbar">
          <div className="toolbar__group">
            <input
              className="input"
              placeholder="Search title, description, or action"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="input filter-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | FeedbackLog["status"])}
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
          <span className="muted">
            Latest update: {summary.latest ? new Date(summary.latest).toLocaleString() : "-"} | Showing {groupedLogs.length} grouped updates
          </span>
        </div>
      </Card>

      <Card title="System Feedback" subtitle="Only meaningful progress, issues, retries, and improvements">
        <div className="feedback-list">
          {groupedLogs.length === 0 && <div className="table__empty">No feedback updates match your filter.</div>}
          {groupedLogs.map((log) => (
            <article className={`feedback-card feedback-card--${log.status}`} key={`${log.id}-${log.created_at}-${log.title}`}>
              <header className="feedback-card__header">
                <div className="feedback-card__title-wrap">
                  <span className="feedback-card__icon">{STATUS_ICON[log.status]}</span>
                  <h3 className="feedback-card__title">{log.title}</h3>
                </div>
                <span className="feedback-card__time">{log.time || new Date(log.created_at).toLocaleTimeString()}</span>
              </header>

              <p className="feedback-card__description">{log.description}</p>
              <p className="feedback-card__action">
                <strong>Action:</strong> {log.action}
              </p>
              {log.count > 1 && <p className="feedback-card__grouped">{log.count} similar updates grouped</p>}
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
