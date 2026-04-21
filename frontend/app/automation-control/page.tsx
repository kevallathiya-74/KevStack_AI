"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import { fetchSettings, generateContent, getUserFriendlyError, publishPost, type AppSettings } from "@/lib/api";

export default function AutomationControlPage() {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("Idle. Enter a topic to start.");
  const [strategyHint, setStrategyHint] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
      if (result.growthDecision?.strategy) {
        setStrategyHint(`Strategy: ${result.growthDecision.strategy} — ${result.growthDecision.reason}`);
      }
      const message = "Step 4/4: generated successfully.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess("Automation generation completed successfully.");
    } catch (error) {
      const message = getUserFriendlyError(error, "Generation failed. Please try again.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setGenerating(false);
    }
  }

  async function runPublish() {
    const payload = topic.trim();
    if (!payload) {
      const message = "Enter publish content first.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setStatus("Running safe publish...");
    setStatusTone("neutral");
    setPublishing(true);
    try {
      const result = await publishPost({ content: payload });
      const mode = result.mode ? ` [mode: ${result.mode}]` : "";
      const message = `${result.reason}${mode}`;
      setStatus(message);
      setStatusTone(result.published ? "success" : "neutral");
      if (result.published) {
        toastSuccess(message);
      } else {
        toastInfo(message);
      }
    } catch (error) {
      const message = getUserFriendlyError(error, "Publish failed. Please try again.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <Card title="Automation Control" subtitle="Daily-safe automation with manual override">
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
        <EmptyState title="Automation context unavailable" message="Try refreshing to load publishing safety controls." />
      </div>
    );
  }

  return (
    <div className="stack">
      <Card title="Automation Control" subtitle="Daily-safe automation with manual override">
        <p className="muted">
          Safe mode: {settings.safeMode ? "Enabled" : "Disabled"} | Publish enabled: {settings.publishEnabled ? "Yes" : "No"} |
          Max posts/day: {settings.maxPostsPerDay} | Max actions/day: {settings.maxActionsPerDay}
        </p>

        {!topic.trim() && (
          <EmptyState
            title="No automation task queued"
            message="Enter a topic to run generation or provide publish content to run the safe publish command."
          />
        )}

        <div className="inline-form">
          <input
            className="input"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter topic or publish content"
          />
        </div>
        <div className="actions">
          <Button onClick={runGenerate} disabled={!topic.trim() || generating || publishing}>
            {generating ? "Running Generate..." : "Run Generate"}
          </Button>
          <Button onClick={runPublish} disabled={!topic.trim() || generating || publishing}>
            {publishing ? "Running Publish..." : "Run Safe Publish"}
          </Button>
        </div>
        <p className={`status status--${statusTone}`}>{status}</p>
        {strategyHint && <p className="muted">{strategyHint}</p>}
      </Card>
    </div>
  );
}
