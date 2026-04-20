import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: false, quiet: true });

const PROVIDER_TIMEOUT_MS = Math.max(3000, Number.parseInt(process.env.PROVIDER_TIMEOUT_MS || "12000", 10) || 12000);

async function fetchWithTimeout(url, options, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractContent(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return payload;

  if (Array.isArray(payload.choices) && payload.choices[0]?.message?.content) {
    return payload.choices[0].message.content;
  }

  if (Array.isArray(payload.output_text)) {
    return payload.output_text.join("\n");
  }

  if (typeof payload.output_text === "string") return payload.output_text;
  return null;
}

async function callGroq(messages) {
  if (!process.env.GROQ_API_KEY) return null;

  const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  return {
    provider: "groq",
    content: extractContent(await response.json()),
  };
}

async function callNvidia(messages) {
  if (!process.env.NVIDIA_API_KEY) return null;

  const response = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct",
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  return {
    provider: "nvidia",
    content: extractContent(await response.json()),
  };
}

export function configuredProviders() {
  return {
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
  };
}

export async function callProvider(provider, messages) {
  if (provider === "nvidia") return callNvidia(messages);
  if (provider === "groq") return callGroq(messages);
  return null;
}
