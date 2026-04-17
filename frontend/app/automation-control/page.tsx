"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { generateContent, getUserFriendlyError, publishPost } from "@/lib/api";

export default function AutomationControlPage() {
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("Idle");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");

  async function runGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setStatus("Enter a topic first.");
      setStatusTone("error");
      return;
    }

    setStatus("Generating post...");
    setStatusTone("neutral");
    try {
      await generateContent(normalizedTopic);
      setStatus("Generated successfully.");
      setStatusTone("success");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Generation failed. Please try again."));
      setStatusTone("error");
    }
  }

  async function runPublish() {
    const payload = topic.trim();
    if (!payload) {
      setStatus("Enter publish content first.");
      setStatusTone("error");
      return;
    }

    setStatus("Running safe publish...");
    setStatusTone("neutral");
    try {
      const result = await publishPost({ content: payload });
      setStatus(result.reason);
      setStatusTone(result.published ? "success" : "neutral");
    } catch (error) {
      setStatus(getUserFriendlyError(error, "Publish failed. Please try again."));
      setStatusTone("error");
    }
  }

  return (
    <div className="stack">
      <Card title="Automation Control" subtitle="Daily-safe automation with manual override">
        <div className="inline-form">
          <input
            className="input"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter topic or publish content"
          />
        </div>
        <div className="actions">
          <Button onClick={runGenerate} disabled={!topic.trim()}>
            Run Generate
          </Button>
          <Button onClick={runPublish} disabled={!topic.trim()}>
            Run Safe Publish
          </Button>
        </div>
        <p className={`status status--${statusTone}`}>{status}</p>
      </Card>
    </div>
  );
}
