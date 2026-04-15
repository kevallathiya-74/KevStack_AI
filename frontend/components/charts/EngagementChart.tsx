"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DashboardMetric } from "@/lib/api";

type Props = {
  metrics: DashboardMetric[];
};

export function EngagementChart({ metrics }: Props) {
  const chartData = [...metrics].reverse().map((item) => ({
    date: new Date(item.created_at).toLocaleDateString(),
    impressions: item.impressions,
    likes: item.likes,
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Line type="monotone" dataKey="impressions" stroke="#1f2937" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="likes" stroke="#2563eb" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
