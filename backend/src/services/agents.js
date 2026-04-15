const { runHfModel } = require("./modelClient");
const { loadEnv } = require("../config/env");

const env = loadEnv();

async function analyzerAgent(topic) {
  return {
    audience: "developers and engineering leads",
    painPoint: `Teams struggle with ${topic} due to fragmented workflows and unclear ownership.`,
    angle: "practical and implementation-first",
  };
}

async function strategyAgent(topic, analysis) {
  return {
    topic,
    storyArc: [
      "real scenario",
      "what broke and why",
      "what changed in architecture",
      "measured result",
    ],
    tone: `${analysis.angle}, specific, and grounded in delivery outcomes`,
  };
}

async function contentGeneratorAgent(topic, strategy) {
  const fallback = [
    `Last sprint we hit a wall while scaling ${topic}.`,
    "Our process looked fast on paper, but handoffs made every issue harder to isolate.",
    "We simplified ownership: one source of truth per module, observable logs, and explicit retry boundaries.",
    "Within a week, deployment confidence improved and post-release fixes dropped noticeably.",
    "If your roadmap is growing faster than your system reliability, start by tightening your operational feedback loop.",
  ].join(" ");

  const prompt = `Write a LinkedIn post for software engineers about ${topic}. Use this strategy: ${JSON.stringify(
    strategy
  )}. Keep it natural and practical.`;

  return runHfModel(env.mistralModel, prompt, fallback);
}

async function hookGeneratorAgent(topic, content) {
  const fallbackHooks = [
    `We improved ${topic} by removing one hidden bottleneck.`,
    `The fastest way we stabilized ${topic} was not more tooling.`,
    `A simple architecture decision fixed our ${topic} chaos.`,
  ];

  const prompt = `Generate 3 short hooks and 1 CTA for a LinkedIn post about ${topic}. Content: ${content}`;
  const generated = await runHfModel(env.flanModel, prompt, fallbackHooks.join("\n"));

  const lines = generated
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const hooks = lines.slice(0, 3).length ? lines.slice(0, 3) : fallbackHooks;
  const cta = lines[3] || "What change has made the biggest reliability impact in your stack this quarter?";

  return { hooks, cta };
}

async function engagementAgent(content, hooks) {
  const selectedHook = hooks[0] || "A practical delivery lesson from this sprint.";
  return `${selectedHook}\n\n${content}`;
}

async function learningAgent(metrics) {
  const engagementScore = (metrics.likes || 0) + (metrics.comments || 0) * 2 + (metrics.shares || 0) * 3;

  return {
    recommendation:
      engagementScore > 10
        ? "Keep using scenario-led stories with concrete implementation lessons."
        : "Use shorter opening lines and include one specific outcome metric earlier.",
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
