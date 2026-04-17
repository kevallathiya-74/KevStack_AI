"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DashboardLog, fetchLogs, getUserFriendlyError } from "@/lib/api";

export default function LogsPage() {
  const [logs, setLogs] = useState<DashboardLog[]>([]);
  const [status, setStatus] = useState("Loading logs...");
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");

  useEffect(() => {
    fetchLogs()
      .then((data) => {
        setLogs(data.logs || []);
        setStatus("");
      })
      .catch((error) => {
        setLogs([]);
        setStatus(getUserFriendlyError(error, "Unable to load logs right now."));
        setStatusTone("error");
      });
  }, []);

  return (
    <div className="stack">
      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      <Card title="System Logs" subtitle="Error tracking and applied fixes">
        <div className="table table--4">
          <div className="table__head">
            <span>Level</span>
            <span>Type</span>
            <span>Cause</span>
            <span>Fix Applied</span>
          </div>
          {logs.length === 0 && <div className="table__empty">No logs available.</div>}
          {logs.map((log) => (
            <div className="table__row" key={log.id}>
              <span>{log.level}</span>
              <span>{log.type || "-"}</span>
              <span>{log.cause || "-"}</span>
              <span>{log.fix_applied || "-"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
