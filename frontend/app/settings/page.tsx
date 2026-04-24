"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import {
  connectLinkedIn,
  disconnectLinkedIn,
  fetchSettings,
  getUserFriendlyError,
  type AppSettings,
} from "@/lib/api";

function boolLabel(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

export default function SettingsPage() {
  const { error: toastError, success: toastSuccess, info: toastInfo } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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

  async function handleConnectLinkedIn() {
    setConnecting(true);
    try {
      const result = await connectLinkedIn();
      setSettings((current) =>
        current
          ? {
              ...current,
              linkedInConnection: result,
            }
          : current
      );
      toastSuccess(result.connected ? `LinkedIn connected as ${result.profileName}.` : "LinkedIn connected.");
    } catch (requestError) {
      toastError(getUserFriendlyError(requestError, "Unable to connect LinkedIn. Please try again."));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnectLinkedIn() {
    setDisconnecting(true);
    try {
      await disconnectLinkedIn();
      setSettings((current) =>
        current
          ? {
              ...current,
              linkedInConnection: {
                connected: false,
                profileName: "",
                profileUrl: "",
                connectedAt: null,
                lastValidatedAt: null,
              },
            }
          : current
      );
      toastInfo("LinkedIn session removed.");
    } catch (requestError) {
      toastError(getUserFriendlyError(requestError, "Unable to disconnect LinkedIn."));
    } finally {
      setDisconnecting(false);
    }
  }

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
              </ul>
            </Card>
          </section>

          <section className="settings-linkedin">
            <Card title="LinkedIn Connection" subtitle="Connect once with a secure browser session. Approval is still required before every post.">
              <div className="linkedin-panel">
                <div className="linkedin-panel__status">
                  <span className={`badge ${settings.linkedInConnection.connected ? "badge--published" : "badge--pending_manual"}`}>
                    {settings.linkedInConnection.connected ? "Connected" : "Not connected"}
                  </span>
                  <div className="linkedin-panel__meta">
                    <p className="linkedin-panel__name">
                      {settings.linkedInConnection.connected
                        ? settings.linkedInConnection.profileName || "LinkedIn account connected"
                        : "No LinkedIn session saved"}
                    </p>
                    <p className="muted">
                      {settings.linkedInConnection.connected
                        ? `Connected at ${new Date(settings.linkedInConnection.connectedAt || "").toLocaleString()}`
                        : "Use Connect LinkedIn to open a secure browser login and store encrypted session cookies on the backend."}
                    </p>
                    {settings.linkedInConnection.profileUrl && (
                      <a href={settings.linkedInConnection.profileUrl} target="_blank" rel="noreferrer" className="linkedin-panel__link">
                        View LinkedIn profile
                      </a>
                    )}
                  </div>
                </div>

                <div className="actions">
                  <Button onClick={handleConnectLinkedIn} disabled={connecting || disconnecting}>
                    {connecting
                      ? "Waiting for login..."
                      : settings.linkedInConnection.connected
                        ? "Reconnect LinkedIn"
                        : "Connect LinkedIn"}
                  </Button>
                  {settings.linkedInConnection.connected && (
                    <Button onClick={handleDisconnectLinkedIn} disabled={connecting || disconnecting} className="btn--ghost">
                      {disconnecting ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
