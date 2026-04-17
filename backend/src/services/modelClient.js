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

async function runHfModel(model, prompt) {
  if (!env.huggingFaceApiToken) {
    throw new Error("HUGGING_FACE_API_TOKEN is required for real model inference.");
  }

  try {
    const response = await axios.post(
      "https://router.huggingface.co/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
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
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (body?.error) {
      throw new Error(`Model response error: ${JSON.stringify(body.error)}`);
    }

    throw new Error("Model returned an unsupported response payload.");
  } catch (error) {
    const cause = extractHfError(error);
    logError("API_FAILURE", cause, "Generation failed without local fallback", {
      model,
      status: error?.response?.status,
    });
    throw new Error(cause);
  }
}

module.exports = {
  runHfModel,
};
