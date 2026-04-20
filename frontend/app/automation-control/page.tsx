"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { generateContent, getUserFriendlyError, publishPost } from "@/lib/api";

export default function AutomationControlPage() {
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("Idle");
  const [strategyHint, setStrategyHint] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");

  async function runGenerate() {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setStatus("Enter a topic first.");
      setStatusTone("error");
      return;
    }

    setStatus("Step 1/4: validating topic...");
    setStatusTone("neutral");
    setStrategyHint("");
    try {
      setStatus("Step 2/4: analyzing historical performance...");
      const generationPromise = generateContent(normalizedTopic);
      setStatus("Step 3/4: generating content, hooks, and CTA...");
      const result = await generationPromise;
      if (result.growthDecision?.strategy) {
        setStrategyHint(`Strategy: ${result.growthDecision.strategy} — ${result.growthDecision.reason}`);
      }
      setStatus("Step 4/4: generated successfully.");
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
      const mode = result.mode ? ` [mode: ${result.mode}]` : "";
      setStatus(`${result.reason}${mode}`);
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
        {strategyHint && <p className="muted">{strategyHint}</p>}
      </Card>
    </div>
  );
}
