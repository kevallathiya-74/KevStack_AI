"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { EngagementChart } from "@/components/charts/EngagementChart";
import { fetchDashboard, DashboardMetric, DashboardPost } from "@/lib/api";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [posts, setPosts] = useState<DashboardPost[]>([]);

  useEffect(() => {
    fetchDashboard()
      .then((data) => {
        setMetrics(data.metrics || []);
        setPosts(data.posts || []);
      })
      .catch(() => {
        setMetrics([]);
        setPosts([]);
      });
  }, []);

  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, metric) => {
        acc.impressions += metric.impressions || 0;
        acc.likes += metric.likes || 0;
        acc.comments += metric.comments || 0;
        return acc;
      },
      { impressions: 0, likes: 0, comments: 0 }
    );
  }, [metrics]);

  return (
    <div className="stack">
      <div className="metrics-grid">
        <MetricCard label="Total Impressions" value={totals.impressions} />
        <MetricCard label="Total Likes" value={totals.likes} />
        <MetricCard label="Total Comments" value={totals.comments} />
        <MetricCard label="Generated Posts" value={posts.length} />
      </div>

      <Card title="Engagement Trend" subtitle="Recent post visibility and reactions">
        <EngagementChart metrics={metrics} />
      </Card>

      <Card title="Latest Posts" subtitle="Recent generated drafts and published content">
        <div className="table table--3">
          <div className="table__head">
            <span>Topic</span>
            <span>Status</span>
            <span>Created</span>
          </div>
          {posts.length === 0 && <div className="table__empty">No posts yet.</div>}
          {posts.map((post) => (
            <div className="table__row" key={post.id}>
              <span>{post.topic}</span>
              <span>{post.status}</span>
              <span>{new Date(post.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
