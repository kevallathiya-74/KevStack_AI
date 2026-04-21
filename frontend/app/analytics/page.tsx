"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EngagementChart } from "@/components/charts/EngagementChart";
import { MetricCard } from "@/components/ui/MetricCard";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import { DashboardMetric, fetchAnalytics, getUserFriendlyError } from "@/lib/api";

const RANGE_OPTIONS = [
  { label: "7D", value: 7 },
  { label: "14D", value: 14 },
  { label: "30D", value: 30 },
] as const;

const numberFormatter = new Intl.NumberFormat();

export default function AnalyticsPage() {
  const { error: toastError } = useToast();
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]["value"]>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchAnalytics();
      setMetrics(data.metrics || []);
    } catch (requestError) {
      setMetrics([]);
      const message = getUserFriendlyError(requestError, "Unable to load analytics right now.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const visibleMetrics = useMemo(() => {
    if (!metrics.length) {
      return [];
    }

    const latestTime = Math.max(...metrics.map((metric) => new Date(metric.created_at).getTime()));
    const earliestAllowed = latestTime - rangeDays * 24 * 60 * 60 * 1000;

    return metrics.filter((metric) => new Date(metric.created_at).getTime() >= earliestAllowed);
  }, [metrics, rangeDays]);

  const totals = useMemo(() => {
    return visibleMetrics.reduce(
      (acc, metric) => {
        acc.impressions += metric.impressions || 0;
        acc.likes += metric.likes || 0;
        acc.comments += metric.comments || 0;
        acc.shares += metric.shares || 0;
        return acc;
      },
      { impressions: 0, likes: 0, comments: 0, shares: 0 }
    );
  }, [visibleMetrics]);

  const summary = useMemo(() => {
    const sampleCount = visibleMetrics.length;
    const interactionTotal = totals.likes + totals.comments + totals.shares;
    const engagementRate = totals.impressions > 0 ? (interactionTotal / totals.impressions) * 100 : 0;

    return {
      sampleCount,
      avgImpressions: sampleCount ? Math.round(totals.impressions / sampleCount) : 0,
      engagementRate,
      interactionTotal,
    };
  }, [totals, visibleMetrics.length]);

  const recentRows = useMemo(() => {
    return [...visibleMetrics]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8);
  }, [visibleMetrics]);

  if (loading) {
    return (
      <div className="stack">
        <Card title="Analytics Overview" subtitle="Choose a range and inspect trend quality with interaction context">
          <div className="metrics-grid">
            <MetricCard label="Total Impressions" value="-" loading />
            <MetricCard label="Total Interactions" value="-" loading />
            <MetricCard label="Average Impressions/Post" value="-" loading />
            <MetricCard label="Engagement Rate" value="-" loading />
          </div>
        </Card>

        <Card title="Analytics" subtitle="Content performance over time">
          <EngagementChart metrics={[]} loading />
        </Card>

        <Card title="Recent Metric Samples" subtitle="Latest entries used to build this chart">
          <SkeletonCard lines={5} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorState message={error} onRetry={() => void loadAnalytics()} />
      </div>
    );
  }

  if (!metrics.length) {
    return (
      <div className="stack">
        <EmptyState
          title="No performance data yet"
          message="Submit engagement metrics from Dashboard to unlock trend analysis and range-based insights."
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <Card title="Analytics Overview" subtitle="Choose a range and inspect trend quality with interaction context">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Analytics time range">
            {RANGE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={`segmented__btn ${rangeDays === option.value ? "is-active" : ""}`}
                onClick={() => setRangeDays(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="muted">{visibleMetrics.length} metric points in current range</span>
        </div>

        <div className="metrics-grid">
          <MetricCard label="Total Impressions" value={numberFormatter.format(totals.impressions)} />
          <MetricCard label="Total Interactions" value={numberFormatter.format(summary.interactionTotal)} />
          <MetricCard label="Average Impressions/Post" value={numberFormatter.format(summary.avgImpressions)} />
          <MetricCard label="Engagement Rate" value={`${summary.engagementRate.toFixed(2)}%`} />
        </div>
      </Card>

      <Card title="Analytics" subtitle="Content performance over time">
        {visibleMetrics.length === 0 ? (
          <EmptyState
            title="No samples for this range"
            message="Try a wider range to include more entries and regenerate the trend chart."
          />
        ) : (
          <EngagementChart metrics={visibleMetrics} />
        )}
      </Card>

      <Card title="Recent Metric Samples" subtitle="Latest entries used to build this chart">
        {recentRows.length === 0 ? (
          <EmptyState title="No rows for this range" message="Adjust the range to reveal recent metric samples." />
        ) : (
          <div className="table table--5">
            <div className="table__head">
              <span>Captured</span>
              <span>Impressions</span>
              <span>Likes</span>
              <span>Comments</span>
              <span>Engagement</span>
            </div>
            {recentRows.map((metric) => {
              const interactions = (metric.likes || 0) + (metric.comments || 0) + (metric.shares || 0);
              const rate = metric.impressions ? (interactions / metric.impressions) * 100 : 0;

              return (
                <div className="table__row" key={metric.id}>
                  <span>{new Date(metric.created_at).toLocaleString()}</span>
                  <span>{numberFormatter.format(metric.impressions || 0)}</span>
                  <span>{numberFormatter.format(metric.likes || 0)}</span>
                  <span>{numberFormatter.format(metric.comments || 0)}</span>
                  <span>{rate.toFixed(2)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
