const { runHfModel } = require("./modelClient");
const { loadEnv } = require("../config/env");

const env = loadEnv();
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "just",
  "lessons",
  "more",
  "next",
  "review",
  "strategy",
  "their",
  "there",
  "these",
  "they",
  "this",
  "topic",
  "with",
  "your",
]);

function parseJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_nestedError) {
      return null;
    }
  }
}

async function runJsonModel(model, prompt, validator, label) {
  const prompts = [
    prompt,
    `${prompt}\nReturn valid JSON only. No prose, no markdown, and no code fences.`,
  ];

  for (const currentPrompt of prompts) {
    const generated = await runHfModel(model, currentPrompt);
    const parsed = parseJsonObject(generated);
    if (validator(parsed)) {
      return parsed;
    }
  }

  throw new Error(`${label} model did not return valid JSON.`);
}

function toLinkedInPlainText(rawText) {
  let text = String(rawText || "").replace(/\r/g, "");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/__(.*?)__/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^>\s*/gm, "");
  text = text.replace(/^[-*]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/^---+$/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function toSingleLine(rawText) {
  return toLinkedInPlainText(rawText).replace(/\s+/g, " ").trim();
}

function extractTopicHashtags(topic) {
  const words = String(topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

  const unique = [...new Set(words)].slice(0, 5);
  return unique.map((word) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}

function ensureHashtags(text, topic) {
  const normalizedText = toLinkedInPlainText(text);
  const existing = normalizedText.match(/#[A-Za-z0-9_]+/g) || [];
  if (existing.length >= 3) {
    return normalizedText;
  }

  const additions = extractTopicHashtags(topic).filter((tag) => !existing.includes(tag)).slice(0, 3 - existing.length);
  if (!additions.length) {
    return normalizedText;
  }

  return `${normalizedText}\n\n${additions.join(" ")}`.trim();
}

async function analyzerAgent(topic, performanceContext) {
  const prompt = [
    "Analyze this engineering topic for a LinkedIn post.",
    `Topic: ${topic}`,
    `Performance context: ${JSON.stringify(performanceContext)}`,
    'Return strict JSON only in this shape: {"audience":"...","painPoint":"...","angle":"..."}.',
    "Keep each value concise, practical, and tied to the performance context when data is available.",
  ].join("\n");

  const parsed = await runJsonModel(
    env.mistralModel,
    prompt,
    (value) =>
      Boolean(value) &&
      typeof value.audience === "string" &&
      typeof value.painPoint === "string" &&
      typeof value.angle === "string",
    "Analyzer"
  );

  const audience = parsed.audience.trim();
  const painPoint = parsed.painPoint.trim();
  const angle = parsed.angle.trim();

  if (!audience || !painPoint || !angle) {
    throw new Error("Analyzer model returned incomplete values.");
  }

  return { audience, painPoint, angle };
}

async function strategyAgent(topic, analysis, performanceContext) {
  const prompt = [
    "Create a post strategy for this topic and analysis.",
    `Topic: ${topic}`,
    `Analysis: ${JSON.stringify(analysis)}`,
    `Performance context: ${JSON.stringify(performanceContext)}`,
    'Return strict JSON only in this shape: {"storyArc":["step1","step2","step3","step4"],"tone":"..."}.',
    "Story arc must have exactly 4 concise steps and reference concrete data signals when available.",
  ].join("\n");

  const parsed = await runJsonModel(
    env.mistralModel,
    prompt,
    (value) => Boolean(value) && Array.isArray(value.storyArc) && typeof value.tone === "string",
    "Strategy"
  );

  const storyArc = parsed.storyArc.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
  const tone = parsed.tone.trim();

  if (storyArc.length < 4 || !tone) {
    throw new Error("Strategy model returned incomplete values.");
  }

  return { topic, storyArc, tone };
}

async function contentGeneratorAgent(topic, strategy, performanceContext) {
  const prompt = [
    "You are writing a copy-paste-ready LinkedIn post for software engineers.",
    `Topic: ${topic}`,
    `Strategy JSON: ${JSON.stringify(strategy)}`,
    `Performance context JSON: ${JSON.stringify(performanceContext)}`,
    "Output requirements:",
    "- Plain text only (no markdown headers, bullets, or code fences).",
    "- Use short paragraphs, each 1-2 sentences, with a blank line between paragraphs.",
    "- Follow this order: Hook, Story, Problem, Insight, Actionable Tip, CTA.",
    "- Hook must be the first two lines and create curiosity.",
    "- Include one concrete mistake and one practical lesson.",
    "- If metric samples exist, include exact values from the performance context.",
    "- End with 3 to 5 relevant hashtags.",
  ].join("\n");

  const generated = await runHfModel(env.mistralModel, prompt);
  if (!generated || !generated.trim()) {
    throw new Error("Mistral model returned empty content.");
  }

  const content = ensureHashtags(toLinkedInPlainText(generated), topic);
  if (content.length < 180) {
    throw new Error("Generated content is too short for LinkedIn quality requirements.");
  }

  return content;
}

async function hookGeneratorAgent(topic, content) {
  const prompt = [
    "Generate exactly 3 high-retention hooks and 1 CTA for a LinkedIn post.",
    `Topic: ${topic}`,
    `Content: ${content}`,
    'Return strict JSON only in this shape: {"hooks":["hook1","hook2","hook3"],"cta":"one line CTA question"}.',
    "Hooks should be concise, specific, and practical for engineers.",
  ].join("\n");

  const parsed = await runJsonModel(
    env.flanModel,
    prompt,
    (value) => Boolean(value) && Array.isArray(value.hooks) && typeof value.cta === "string",
    "Hook"
  );

  const hooks = parsed.hooks.map((hook) => toSingleLine(hook)).filter(Boolean).slice(0, 3);
  const cta = toSingleLine(parsed.cta);

  if (hooks.length < 3 || !cta) {
    throw new Error("Hook model output is incomplete.");
  }

  return { hooks, cta };
}

async function engagementAgent(topic, content, hooks) {
  const primaryHook = hooks[0] || "";
  const prompt = [
    "Refine this LinkedIn post for stronger engagement while preserving factual details.",
    `Topic: ${topic}`,
    `Primary hook: ${primaryHook}`,
    `Draft content: ${content}`,
    "Return plain text only.",
    "Keep short paragraphs, one blank line between paragraphs, and keep the final CTA as a single question line.",
    "Do not invent metrics or tools not present in the draft.",
  ].join("\n");

  const generated = await runHfModel(env.mistralModel, prompt);
  if (!generated || !generated.trim()) {
    throw new Error("Engagement optimization returned empty content.");
  }

  return ensureHashtags(toLinkedInPlainText(generated), topic);
}

async function learningAgent(metrics) {
  const prompt = [
    "You are a growth analyst for LinkedIn engineering content.",
    `Metrics JSON: ${JSON.stringify(metrics)}`,
    'Return strict JSON only in this shape: {"recommendation":"one concise recommendation"}.',
  ].join("\n");

  const parsed = await runJsonModel(
    env.flanModel,
    prompt,
    (value) => Boolean(value) && typeof value.recommendation === "string" && Boolean(value.recommendation.trim()),
    "Learning"
  );

  return {
    recommendation: toSingleLine(parsed.recommendation),
  };
}

module.exports = {
  analyzerAgent,
  strategyAgent,
  contentGeneratorAgent,
  hookGeneratorAgent,
  engagementAgent,
  learningAgent,
};
