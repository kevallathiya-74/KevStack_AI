"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextareaEditor } from "@/components/ui/TextareaEditor";
import { GeneratedHookScore, generateContent, generateContentFromData, getUserFriendlyError, publishPost } from "@/lib/api";

export default function ContentStudioPage() {
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [hookScores, setHookScores] = useState<GeneratedHookScore[]>([]);
  const [cta, setCta] = useState("");
  const [status, setStatus] = useState("Enter a topic and generate real content.");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function handleGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setStatus("Topic is required.");
      setStatusTone("error");
      return;
    }

    setLoading(true);
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
      setStatus("Content generated from live model output with scored hooks.");
      setStatusTone("success");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Unable to generate content right now."));
      setStatusTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFromData() {
    setLoading(true);
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
      setStatus("Content generated from real dashboard data.");
      setStatusTone("success");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Unable to generate content from dashboard data right now."));
      setStatusTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishDraft() {
    const payload = content.trim();
    if (!payload) {
      setStatus("Generate or write post content before publishing.");
      setStatusTone("error");
      return;
    }

    setPublishing(true);
    setStatusTone("neutral");
    setStatus("Publishing with LinkedIn safety checks...");
    try {
      const result = await publishPost({ content: payload });
      setStatus(result.reason || "Publish request completed.");
      setStatusTone(result.published ? "success" : "neutral");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Publish failed. Please try again."));
      setStatusTone("error");
    } finally {
      setPublishing(false);
    }
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
          <Button onClick={handleGenerate} disabled={loading || !topic.trim()}>
            {loading ? "Generating..." : "Generate"}
          </Button>
        </div>
        <div className="actions">
          <Button onClick={handleGenerateFromData} disabled={loading}>
            {loading ? "Generating..." : "Generate From Data"}
          </Button>
        </div>
        <p className={`status status--${statusTone}`}>{status}</p>
      </Card>

      <Card title="Draft Editor">
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
      </Card>

      <Card title="Hooks & CTA">
        <ul className="list">
          {(hookScores.length ? hookScores : hooks.map((hook) => ({ hook, score: 0 }))).map((item) => (
            <li key={item.hook}>
              {item.hook}
              {hookScores.length > 0 ? ` (score: ${item.score})` : ""}
            </li>
          ))}
          {!hooks.length && <li>No hooks generated yet.</li>}
        </ul>
        <p className="cta">{cta || "CTA will appear after generation."}</p>
      </Card>
    </div>
  );
}
