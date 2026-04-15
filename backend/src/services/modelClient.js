const axios = require("axios");
const { loadEnv } = require("../config/env");
const { logError } = require("./logger");

const env = loadEnv();

async function runHfModel(model, prompt, fallbackText) {
  if (!env.huggingFaceApiToken) {
    return fallbackText;
  }

  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: prompt },
      {
        headers: {
          Authorization: `Bearer ${env.huggingFaceApiToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const body = response.data;
    if (Array.isArray(body) && body[0]?.generated_text) {
      return body[0].generated_text;
    }

    if (typeof body === "string") {
      return body;
    }

    return fallbackText;
  } catch (error) {
    logError("API_FAILURE", error.message, "Fell back to local deterministic generator", {
      model,
    });
    return fallbackText;
  }
}

module.exports = {
  runHfModel,
};
