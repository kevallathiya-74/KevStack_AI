"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextareaEditor } from "@/components/ui/TextareaEditor";
import { generateContent, generateContentFromData, getUserFriendlyError } from "@/lib/api";

export default function ContentStudioPage() {
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [cta, setCta] = useState("");
  const [status, setStatus] = useState("Enter a topic and generate real content.");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [loading, setLoading] = useState(false);

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
      setContent(result?.post?.content || "");
      setHooks(result?.post?.hooks || []);
      setCta(result?.post?.cta || "");
      setStatus("Content generated from live model output.");
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
      setTopic(result?.topic || "");
      setContent(result?.post?.content || "");
      setHooks(result?.post?.hooks || []);
      setCta(result?.post?.cta || "");
      setStatus("Content generated from real dashboard data.");
      setStatusTone("success");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Unable to generate content from dashboard data right now."));
      setStatusTone("error");
    } finally {
      setLoading(false);
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
      </Card>

      <Card title="Hooks & CTA">
        <ul className="list">
          {hooks.map((hook) => (
            <li key={hook}>{hook}</li>
          ))}
          {!hooks.length && <li>No hooks generated yet.</li>}
        </ul>
        <p className="cta">{cta || "CTA will appear after generation."}</p>
      </Card>
    </div>
  );
}
