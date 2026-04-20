const axios = require("axios");
const { loadEnv } = require("../config/env");
const { logError } = require("./logger");

const env = loadEnv();

function extractHfError(error) {
  const responseData = error?.response?.data;

  if (typeof responseData === "string" && responseData.trim()) {
    return responseData;
  }

  if (typeof responseData?.error === "string") {
    return responseData.error;
  }

  if (typeof responseData?.error?.message === "string") {
    return responseData.error.message;
  }

  return error?.message || "Hugging Face request failed";
}

function sanitizeModelOutput(rawContent) {
  const value = String(rawContent || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (!value) {
    return "";
  }

  return value
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function runHfModel(model, prompt, options = {}) {
  if (!env.huggingFaceApiToken) {
    throw new Error("HF_TOKEN is required for real model inference.");
  }

  const maxRetries = Number.isInteger(options.maxRetries) ? Math.max(0, Math.min(2, options.maxRetries)) : 2;
  const fallbackPrompt = typeof options.fallbackPrompt === "string" ? options.fallbackPrompt.trim() : "";
  const promptQueue = [String(prompt || "").trim(), fallbackPrompt].filter(Boolean);
  let lastError = null;

  for (const currentPrompt of promptQueue) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await axios.post(
          "https://router.huggingface.co/v1/chat/completions",
          {
            model,
            messages: [{ role: "user", content: currentPrompt }],
            temperature: 0.2,
            max_tokens: 900,
          },
          {
            headers: {
              Authorization: `Bearer ${env.huggingFaceApiToken}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );

        const body = response.data;
        const content = sanitizeModelOutput(body?.choices?.[0]?.message?.content);
        if (content) {
          return content;
        }

        if (body?.error) {
          throw new Error(`Model response error: ${JSON.stringify(body.error)}`);
        }

        throw new Error("Model returned an unsupported response payload.");
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) {
          break;
        }
      }
    }
  }

  const cause = extractHfError(lastError);
  logError("API_FAILURE", cause, "Generation failed after retry and fallback prompts", {
    model,
    status: lastError?.response?.status,
  });
  throw new Error(cause);
}

module.exports = {
  runHfModel,
};
