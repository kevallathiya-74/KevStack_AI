"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import {
  fetchSettings,
  generateContent,
  generateContentFromData,
  getUserFriendlyError,
  type AppSettings,
  type GenerateContentResponse,
} from "@/lib/api";

export default function AutomationControlPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("Idle. Enter a topic to start.");
  const [strategyHint, setStrategyHint] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lastRun, setLastRun] = useState<GenerateContentResponse | null>(null);

  const loadAutomationContext = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchSettings();
      setSettings(response);
    } catch (requestError) {
      setSettings(null);
      const message = getUserFriendlyError(requestError, "Unable to load automation controls right now.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadAutomationContext();
  }, [loadAutomationContext]);

  async function runGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      const message = "Enter a topic first.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setStatus("Step 1/4: validating topic...");
    setStatusTone("neutral");
    setStrategyHint("");
    setGenerating(true);
    try {
      setStatus("Step 2/4: analyzing historical performance...");
      const generationPromise = generateContent(normalizedTopic);
      setStatus("Step 3/4: generating content, hooks, and CTA...");
      const result = await generationPromise;
      setLastRun(result);
      if (result.growthDecision?.strategy) {
        setStrategyHint(`Strategy: ${result.growthDecision.strategy} - ${result.growthDecision.reason}`);
      }
      const message = "Step 4/4: generated successfully.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess("Automation generation completed successfully.");
    } catch (requestError) {
      const message = getUserFriendlyError(requestError, "Generation failed. Please try again.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setGenerating(false);
    }
  }

  async function runGenerateFromData() {
    setStatus("Reviewing live performance data...");
    setStatusTone("neutral");
    setStrategyHint("");
    setGenerating(true);
    try {
      const result = await generateContentFromData();
      setLastRun(result);
      if (result.growthDecision?.strategy) {
        setStrategyHint(`Strategy: ${result.growthDecision.strategy} - ${result.growthDecision.reason}`);
      }
      const message = "Generated a new draft from stored post and metric data.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess(message);
    } catch (requestError) {
      const message = getUserFriendlyError(requestError, "Generation from live data failed. Please try again.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <Card title="Automation Control" subtitle="Daily-safe automation with approval-first publishing">
          <SkeletonCard lines={5} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorState message={error} onRetry={() => void loadAutomationContext()} />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="stack">
        <EmptyState title="Automation context unavailable" message="Try refreshing to load generation safety controls." />
      </div>
    );
  }

  return (
    <div className="stack">
      <Card title="Automation Control" subtitle="Daily-safe automation with approval-first publishing">
        <p className="muted">
          Safe mode: {settings.safeMode ? "Enabled" : "Disabled"} | Publish enabled: {settings.publishEnabled ? "Yes" : "No"} |
          Max posts/day: {settings.maxPostsPerDay} | Max actions/day: {settings.maxActionsPerDay}
        </p>

        {!topic.trim() && !lastRun && (
          <EmptyState
            title="No automation task queued"
            message="Enter a topic to generate a draft, or use the data-driven option to build from recent metrics."
          />
        )}

        <div className="inline-form">
          <input
            className="input"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter a topic to generate the next approval draft"
          />
        </div>
        <div className="actions">
          <Button onClick={runGenerate} disabled={!topic.trim() || generating}>
            {generating ? "Generating..." : "Run Generate"}
          </Button>
          <Button onClick={runGenerateFromData} disabled={generating} className="btn--ghost">
            {generating ? "Reviewing..." : "Generate From Data"}
          </Button>
        </div>
        <p className={`status status--${statusTone}`}>{status}</p>
        {strategyHint && <p className="muted">{strategyHint}</p>}

        {lastRun && (
          <div className="automation-summary">
            <p className="automation-summary__title">Latest automation draft</p>
            <p className="automation-summary__meta">Topic: {lastRun.topic}</p>
            <p className="automation-summary__meta">Primary hook: {lastRun.hook}</p>
            <p className="automation-summary__body">{lastRun.content}</p>
            <p className="muted">Publishing is approval-only. Review the draft in Content Studio before posting.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
