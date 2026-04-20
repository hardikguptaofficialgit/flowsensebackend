import { chatWithAgent, listAgents } from "../services/chatService.js";
import { sendJsonError } from "../utils/http.js";

export function agentCatalog(_req, res) {
  res.json(listAgents());
}

export async function chatMessage(req, res) {
  const message = String(req.body?.message || "").trim();
  const agentId = String(req.body?.agentId || "platform-guide");

  if (!message) {
    sendJsonError(res, 400, "Message is required.");
    return;
  }

  try {
    const result = await chatWithAgent({ agentId, message });
    res.json(result);
  } catch (error) {
    sendJsonError(res, 500, "Chat request failed.", error instanceof Error ? error.message : "Unknown error");
  }
}
