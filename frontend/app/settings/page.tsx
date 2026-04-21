"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import { fetchSettings, getUserFriendlyError, type AppSettings } from "@/lib/api";

function boolLabel(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

export default function SettingsPage() {
  const { error: toastError } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchSettings();
      setSettings(response);
    } catch (requestError: unknown) {
      setSettings(null);
      const message = getUserFriendlyError(requestError, "Unable to load settings.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const safetyStatus = useMemo(() => {
    if (!settings) return "Unknown";
    if (settings.safeMode) return "Safe mode active";
    return settings.publishEnabled ? "Live publishing active" : "Publishing paused";
  }, [settings]);

  return (
    <main className="page">
      <div className="panel-header-row">
        <h1>Settings</h1>
      </div>

      {loading && (
        <section className="metrics-grid">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </section>
      )}

      {!loading && error && <ErrorState message={error} onRetry={() => void loadSettings()} />}

      {!loading && !error && !settings && (
        <EmptyState title="No settings available" message="Settings data is temporarily unavailable. Try again shortly." />
      )}

      {!loading && !error && settings && (
        <>
          <section className="metrics-grid">
            <Card>
              <h2>Safety</h2>
              <p className="muted">{safetyStatus}</p>
              <ul className="insight-list" style={{ marginTop: 12 }}>
                <li>Safe mode: {boolLabel(settings.safeMode)}</li>
                <li>Publishing: {boolLabel(settings.publishEnabled)}</li>
              </ul>
            </Card>

            <Card>
              <h2>Daily Limits</h2>
              <ul className="insight-list" style={{ marginTop: 12 }}>
                <li>Max posts/day: {settings.maxPostsPerDay}</li>
                <li>Max publish actions/day: {settings.maxActionsPerDay}</li>
              </ul>
            </Card>

            <Card>
              <h2>Automation Defaults</h2>
              <ul className="insight-list" style={{ marginTop: 12 }}>
                <li>Default topic: {settings.defaultSchedulerTopic}</li>
              </ul>
            </Card>

            <Card>
              <h2>Integrations</h2>
              <ul className="insight-list" style={{ marginTop: 12 }}>
                <li>HF token configured: {boolLabel(settings.huggingFaceConfigured)}</li>
                <li>LinkedIn credentials: {boolLabel(settings.hasLinkedInCredentials)}</li>
              </ul>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
