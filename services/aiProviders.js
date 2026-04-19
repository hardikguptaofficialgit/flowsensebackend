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

async function callOpenAI(messages) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  return {
    provider: "openai",
    content: extractContent(await response.json()),
  };
}

async function callGroq(messages) {
  if (!process.env.GROQ_API_KEY) return null;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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

async function callPerplexity(messages) {
  if (!process.env.PERPLEXITY_API_KEY) return null;

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || "sonar-pro",
      messages,
      temperature: 0.1,
    }),
  });

  if (!response.ok) return null;
  return {
    provider: "perplexity",
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
  if (provider === "openai") return callOpenAI(messages);
  if (provider === "perplexity") return callPerplexity(messages);
  return null;
}
