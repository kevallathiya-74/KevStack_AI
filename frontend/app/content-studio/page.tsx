"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextareaEditor } from "@/components/ui/TextareaEditor";
import { generateContent } from "@/lib/api";

export default function ContentStudioPage() {
  const [topic, setTopic] = useState("scaling backend reliability with small teams");
  const [content, setContent] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [cta, setCta] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await generateContent(topic);
      setContent(result?.post?.content || "");
      setHooks(result?.post?.hooks || []);
      setCta(result?.post?.cta || "");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <Card title="Content Studio" subtitle="Human-like developer posts with hook optimization">
        <div className="inline-form">
          <input className="input" value={topic} onChange={(event) => setTopic(event.target.value)} />
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? "Generating..." : "Generate"}
          </Button>
        </div>
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
