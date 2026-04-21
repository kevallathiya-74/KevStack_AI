"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { EngagementChart } from "@/components/charts/EngagementChart";
import { Button } from "@/components/ui/Button";
import {
  DashboardMetric,
  DashboardPost,
  fetchDashboard,
  getUserFriendlyError,
  submitMetric,
  type SubmitMetricInput,
} from "@/lib/api";

type MetricDraft = SubmitMetricInput;

const METRIC_DEFAULTS: MetricDraft = {
  post_id: 0,
  impressions: 0,
  likes: 0,
  comments: 0,
  shares: 0,
};

export default function DashboardPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricDraft, setMetricDraft] = useState<MetricDraft>(METRIC_DEFAULTS);
  const [submittingMetric, setSubmittingMetric] = useState(false);
  const [metricStatus, setMetricStatus] = useState("");
  const [metricStatusTone, setMetricStatusTone] = useState<"neutral" | "success" | "error">("neutral");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDashboard();
      const nextMetrics = data.metrics || [];
      const nextPosts = data.posts || [];
      setMetrics(nextMetrics);
      setPosts(nextPosts);
      setMetricDraft((current) => ({
        ...current,
        post_id: current.post_id || nextPosts[0]?.id || 0,
      }));
    } catch (requestError) {
      setMetrics([]);
      setPosts([]);
      const message = getUserFriendlyError(requestError, "Unable to load dashboard data right now.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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

  const hasDashboardData = posts.length > 0 || metrics.length > 0;

  const latestPosts = useMemo(() => {
    return [...posts]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8);
  }, [posts]);

  function updateMetricDraft<K extends keyof MetricDraft>(key: K, value: MetricDraft[K]) {
    setMetricDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmitMetric(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!metricDraft.post_id) {
      const message = "Choose a post before submitting metrics.";
      setMetricStatus(message);
      setMetricStatusTone("error");
      toastError(message);
      return;
    }

    setSubmittingMetric(true);
    setMetricStatusTone("neutral");
    setMetricStatus("Saving metrics...");

    try {
      const { metric } = await submitMetric(metricDraft);
      setMetrics((current) => {
        const deduped = [metric, ...current.filter((item) => item.id !== metric.id)];
        return deduped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      const message = "Metrics saved. Dashboard totals updated from real API response.";
      setMetricStatus(message);
      setMetricStatusTone("success");
      toastSuccess(message);
    } catch (requestError) {
      const message = getUserFriendlyError(requestError, "Unable to submit metrics right now.");
      setMetricStatus(message);
      setMetricStatusTone("error");
      toastError(message);
    } finally {
      setSubmittingMetric(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="metrics-grid">
          <MetricCard label="Total Impressions" value="-" loading />
          <MetricCard label="Total Likes" value="-" loading />
          <MetricCard label="Total Comments" value="-" loading />
          <MetricCard label="Generated Posts" value="-" loading />
        </div>

        <Card title="Engagement Trend" subtitle="Recent post visibility and reactions">
          <EngagementChart metrics={[]} loading />
        </Card>

        <Card title="Latest Posts" subtitle="Recent generated drafts and published content">
          <SkeletonCard lines={4} />
        </Card>

        <Card title="Capture Live Metrics" subtitle="Submit fresh engagement stats for a generated post">
          <SkeletonCard lines={4} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorState message={error} onRetry={() => void loadDashboard()} />
      </div>
    );
  }

  if (!hasDashboardData) {
    return (
      <div className="stack">
        <EmptyState
          title="No analytics data yet"
          message="Generate your first post in Content Studio, then capture engagement metrics to populate this dashboard."
        />
      </div>
    );
  }

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
          {latestPosts.length === 0 && <div className="table__empty">No posts yet.</div>}
          {latestPosts.map((post) => (
            <div className="table__row" key={post.id}>
              <span>{post.topic}</span>
              <span>{post.status}</span>
              <span>{new Date(post.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Capture Live Metrics" subtitle="Submit fresh engagement stats for a generated post">
        {posts.length === 0 ? (
          <EmptyState
            title="No post available"
            message="Generate a post first, then come back here to attach impressions, likes, comments, and shares."
          />
        ) : (
          <form className="metric-form" onSubmit={handleSubmitMetric}>
            <div className="metric-form__grid">
              <label className="metric-form__field">
                <span>Post</span>
                <select
                  className="input"
                  value={metricDraft.post_id}
                  onChange={(event) => updateMetricDraft("post_id", Number(event.target.value))}
                >
                  <option value={0}>Select post</option>
                  {posts.map((post) => (
                    <option key={post.id} value={post.id}>
                      #{post.id} - {post.topic}
                    </option>
                  ))}
                </select>
              </label>

              <label className="metric-form__field">
                <span>Impressions</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={metricDraft.impressions}
                  onChange={(event) => updateMetricDraft("impressions", Math.max(0, Number(event.target.value) || 0))}
                />
              </label>

              <label className="metric-form__field">
                <span>Likes</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={metricDraft.likes}
                  onChange={(event) => updateMetricDraft("likes", Math.max(0, Number(event.target.value) || 0))}
                />
              </label>

              <label className="metric-form__field">
                <span>Comments</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={metricDraft.comments}
                  onChange={(event) => updateMetricDraft("comments", Math.max(0, Number(event.target.value) || 0))}
                />
              </label>

              <label className="metric-form__field">
                <span>Shares</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={metricDraft.shares}
                  onChange={(event) => updateMetricDraft("shares", Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
            </div>

            <div className="metric-form__footer">
              <Button type="submit" disabled={submittingMetric || !metricDraft.post_id}>
                {submittingMetric ? "Saving..." : "Submit Metrics"}
              </Button>
              {metricStatus && <p className={`status status--${metricStatusTone}`}>{metricStatus}</p>}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
