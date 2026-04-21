"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextareaEditor } from "@/components/ui/TextareaEditor";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import SkeletonCard from "@/components/ui/SkeletonCard";
import { useToast } from "@/components/ui/ToastProvider";
import {
  GeneratedHookScore,
  fetchDashboard,
  generateContent,
  generateContentFromData,
  getUserFriendlyError,
  publishPost,
} from "@/lib/api";

type StudioContext = {
  postsCount: number;
  metricsCount: number;
};

export default function ContentStudioPage() {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [hookScores, setHookScores] = useState<GeneratedHookScore[]>([]);
  const [cta, setCta] = useState("");
  const [status, setStatus] = useState("Enter a topic and generate real content.");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<StudioContext | null>(null);

  const displayedHookScores =
    hookScores.length > 0 ? hookScores : hooks.map((hook) => ({ hook, score: 0, reasons: [] as string[] }));

  const canGenerateFromData = useMemo(() => {
    return Boolean(context && (context.postsCount > 0 || context.metricsCount > 0));
  }, [context]);

  const hasGeneratedOutput = Boolean(content.trim() || hooks.length || cta.trim());

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDashboard();
      setContext({
        postsCount: data.posts?.length || 0,
        metricsCount: data.metrics?.length || 0,
      });
    } catch (requestError) {
      setContext(null);
      const message = getUserFriendlyError(requestError, "Unable to load content studio context right now.");
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  async function handleGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      const message = "Topic is required.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setGenerating(true);
    setStatusTone("neutral");
    try {
      const result = await generateContent(normalizedTopic);
      const nextHooks = result?.hooks || result?.post?.hooks || [];
      const nextScores = result?.hookScores || nextHooks.map((hook) => ({ hook, score: 0 }));
      setTopic(result?.topic || normalizedTopic);
      setContent(result?.content || result?.post?.content || "");
      setHooks(nextHooks);
      setHookScores(nextScores);
      setCta(result?.cta || result?.post?.cta || "");
      const message = "Content generated from live model output with scored hooks.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess(message);
    } catch (error) {
      const message = getUserFriendlyError(error, "Unable to generate content right now.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateFromData() {
    if (!canGenerateFromData) {
      const message = "No dashboard data yet. Generate a post first, then retry data-driven generation.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setGenerating(true);
    setStatusTone("neutral");
    try {
      const result = await generateContentFromData();
      const nextHooks = result?.hooks || result?.post?.hooks || [];
      const nextScores = result?.hookScores || nextHooks.map((hook) => ({ hook, score: 0 }));
      setTopic(result?.topic || "");
      setContent(result?.content || result?.post?.content || "");
      setHooks(nextHooks);
      setHookScores(nextScores);
      setCta(result?.cta || result?.post?.cta || "");
      const message = "Content generated from real dashboard data.";
      setStatus(message);
      setStatusTone("success");
      toastSuccess(message);
    } catch (error) {
      const message = getUserFriendlyError(error, "Unable to generate content from dashboard data right now.");
      setStatus(message);
      setStatusTone("error");
      toastError(message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublishDraft() {
    const payload = content.trim();
    if (!payload) {
      const message = "Generate or write post content before publishing.";
      setStatus(message);
      setStatusTone("error");
      toastError(message);
      return;
    }

    setPublishing(true);
    setStatusTone("neutral");
    setStatus("Publishing with LinkedIn safety checks...");
    try {
      const result = await publishPost({ content: payload });
      const message = result.reason || "Publish request completed.";
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
        <Card title="Content Studio" subtitle="Human-like developer posts with hook optimization">
          <SkeletonCard lines={4} />
        </Card>
        <Card title="Draft Editor">
          <SkeletonCard lines={6} />
        </Card>
        <Card title="Hooks & CTA">
          <SkeletonCard lines={4} />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stack">
        <ErrorState message={error} onRetry={() => void loadContext()} />
      </div>
    );
  }

  return (
    <div className="stack">
      <Card title="Content Studio" subtitle="Human-like developer posts with hook optimization">
        <div className="inline-form">
          <input
            className="input"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter topic"
          />
          <Button onClick={handleGenerate} disabled={generating || publishing || !topic.trim()}>
            {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
        <div className="actions">
          <Button onClick={handleGenerateFromData} disabled={generating || publishing || !canGenerateFromData}>
            {generating ? "Generating..." : "Generate From Data"}
          </Button>
        </div>
        <p className="muted">
          Data context: {context?.postsCount || 0} recent posts, {context?.metricsCount || 0} recent metrics
        </p>
        <p className={`status status--${statusTone}`}>{status}</p>
      </Card>

      <Card title="Draft Editor">
        {!content.trim() ? (
          <EmptyState
            title="Start by generating content"
            message="Use topic generation or data-driven generation to create your first draft for editing and publishing."
          />
        ) : (
          <>
            <TextareaEditor
              value={content}
              onChange={setContent}
              placeholder="Generate a post and refine the language before publish"
            />
            <div className="actions">
              <Button onClick={handlePublishDraft} disabled={publishing || !content.trim()}>
                {publishing ? "Publishing..." : "Publish Draft"}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card title="Hooks & CTA">
        {!hasGeneratedOutput ? (
          <EmptyState
            title="No generated hook set yet"
            message="After content generation, hook rankings and CTA recommendations will be displayed here."
          />
        ) : (
          <>
            <ul className="list">
              {displayedHookScores.map((item, index) => (
                <li key={item.hook} className="hook-item">
                  <div className="hook-item__head">
                    <span>{index === 0 ? `⭐ ${item.hook}` : item.hook}</span>
                    <span className="hook-item__score">score: {item.score}</span>
                  </div>
                  {item.reasons && item.reasons.length > 0 && (
                    <small className="hook-item__reasons">why: {item.reasons.join(", ")}</small>
                  )}
                </li>
              ))}
              {!hooks.length && <li>No hooks generated yet.</li>}
            </ul>
            <p className="cta">{cta || "CTA will appear after generation."}</p>
          </>
        )}
      </Card>
    </div>
  );
}
