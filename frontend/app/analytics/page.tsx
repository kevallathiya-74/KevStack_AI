"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EngagementChart } from "@/components/charts/EngagementChart";
import { DashboardMetric, fetchAnalytics } from "@/lib/api";

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);

  useEffect(() => {
    fetchAnalytics()
      .then((data) => setMetrics(data.metrics || []))
      .catch(() => setMetrics([]));
  }, []);

  return (
    <div className="stack">
      <Card title="Analytics" subtitle="Content performance over time">
        <EngagementChart metrics={metrics} />
      </Card>
    </div>
  );
}
