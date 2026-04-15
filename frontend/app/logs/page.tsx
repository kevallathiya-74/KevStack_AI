"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DashboardLog, fetchLogs } from "@/lib/api";

export default function LogsPage() {
  const [logs, setLogs] = useState<DashboardLog[]>([]);

  useEffect(() => {
    fetchLogs()
      .then((data) => setLogs(data.logs || []))
      .catch(() => setLogs([]));
  }, []);

  return (
    <div className="stack">
      <Card title="System Logs" subtitle="Error tracking and applied fixes">
        <div className="table">
          <div className="table__head">
            <span>Level</span>
            <span>Type</span>
            <span>Cause</span>
            <span>Fix Applied</span>
          </div>
          {logs.length === 0 && <div className="table__row">No logs available.</div>}
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
