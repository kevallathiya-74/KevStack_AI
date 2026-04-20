"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DashboardMetric } from "@/lib/api";

type Props = {
  metrics: DashboardMetric[];
};

const numberFormatter = new Intl.NumberFormat();

function formatMetricLabel(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function EngagementChart({ metrics }: Props) {
  const chartData = [...metrics]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((item) => ({
    date: new Date(item.created_at).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    impressions: item.impressions,
    likes: item.likes,
    comments: item.comments,
    shares: item.shares,
  }));

  if (!chartData.length) {
    return (
      <div className="chart-wrap">
        <div className="table__empty">No real metrics yet. Add live metrics to display the engagement trend graph.</div>
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      {chartData.length === 1 && <p className="chart-note">Only one data point is available. Trend lines will improve as new metrics are added.</p>}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
          <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(value) => numberFormatter.format(Number(value))} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            formatter={(value, name) => [numberFormatter.format(Number(value)), formatMetricLabel(String(name))]}
            labelFormatter={(label) => `Captured: ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          <Line type="monotone" yAxisId="left" dataKey="impressions" stroke="#1f2937" strokeWidth={2} dot={false} />
          <Line type="monotone" yAxisId="right" dataKey="likes" stroke="#2563eb" strokeWidth={2} dot={false} />
          <Line type="monotone" yAxisId="right" dataKey="comments" stroke="#0f766e" strokeWidth={2} dot={false} />
          <Line type="monotone" yAxisId="right" dataKey="shares" stroke="#7c3aed" strokeWidth={2} dot={false} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
