"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EngagementChart } from "@/components/charts/EngagementChart";
import { DashboardMetric, fetchAnalytics, getUserFriendlyError } from "@/lib/api";

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [status, setStatus] = useState("Loading analytics...");
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");

  useEffect(() => {
    fetchAnalytics()
      .then((data) => {
        setMetrics(data.metrics || []);
        setStatus("");
      })
      .catch((error) => {
        setMetrics([]);
        setStatus(getUserFriendlyError(error, "Unable to load analytics right now."));
        setStatusTone("error");
      });
  }, []);

  return (
    <div className="stack">
      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      <Card title="Analytics" subtitle="Content performance over time">
        <EngagementChart metrics={metrics} />
      </Card>
    </div>
  );
}
