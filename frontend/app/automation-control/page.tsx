"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { generateContent, publishPost } from "@/lib/api";

export default function AutomationControlPage() {
  const [status, setStatus] = useState("Idle");

  async function runGenerate() {
    setStatus("Generating post...");
    try {
      await generateContent("engineering delivery improvements");
      setStatus("Generated successfully.");
    } catch {
      setStatus("Generation failed.");
    }
  }

  async function runPublish() {
    setStatus("Running safe publish...");
    try {
      const result = await publishPost({ content: "manual-safe-publish" });
      setStatus(result.reason);
    } catch {
      setStatus("Publish failed.");
    }
  }

  return (
    <div className="stack">
      <Card title="Automation Control" subtitle="Daily-safe automation with manual override">
        <div className="actions">
          <Button onClick={runGenerate}>Run Generate</Button>
          <Button onClick={runPublish}>Run Safe Publish</Button>
        </div>
        <p className="status">{status}</p>
      </Card>
    </div>
  );
}
