"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchSettings, getUserFriendlyError, type AppSettings } from "@/lib/api";

function boolLabel(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchSettings();
        if (!mounted) return;
        setSettings(response);
      } catch (err: unknown) {
        if (!mounted) return;
        setError(getUserFriendlyError(err, "Unable to load settings."));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

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

      {loading && <Card>Loading settings...</Card>}

      {!loading && error && <Card>{error}</Card>}

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
