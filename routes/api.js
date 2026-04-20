import { Router } from "express";
import {
  analyzeUrl,
  compareUrls,
  configStatus,
  deploymentHook,
  prMergeHook,
} from "../controllers/analyzeController.js";
import { authSession, googleAuth, requireAuth, signIn, signOut, signUp } from "../controllers/authController.js";
import { agentCatalog, chatMessage } from "../controllers/chatController.js";
import { getProfile, listAnalyses, saveAnalysis, upsertProfile } from "../controllers/workspaceController.js";
import { createRateLimit, verifyWebhookSignature } from "../middleware/security.js";

const router = Router();

const authLimiter = createRateLimit({ windowMs: 15 * 60 * 1000, max: 12, keyFn: (req) => `auth:${req.path}:${req.socket.remoteAddress}` });
const publicAnalyzeLimiter = createRateLimit({ windowMs: 5 * 60 * 1000, max: 30, keyFn: (req) => `analyze:${req.path}:${req.socket.remoteAddress}` });
const webhookLimiter = createRateLimit({ windowMs: 60 * 1000, max: 20, keyFn: (req) => `webhook:${req.path}:${req.socket.remoteAddress}` });

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "flowsense-agent", timestamp: new Date().toISOString() });
});

router.get("/config", configStatus);
router.post("/analyze", publicAnalyzeLimiter, analyzeUrl);
router.post("/compare", publicAnalyzeLimiter, compareUrls);
router.post("/hooks/deployment", webhookLimiter, verifyWebhookSignature, deploymentHook);
router.post("/hooks/pr-merge", webhookLimiter, verifyWebhookSignature, prMergeHook);

router.post("/auth/signup", authLimiter, signUp);
router.post("/auth/signin", authLimiter, signIn);
router.post("/auth/google", authLimiter, googleAuth);
router.post("/auth/signout", signOut);
router.get("/auth/session", authSession);

router.get("/workspace/profile", requireAuth, getProfile);
router.put("/workspace/profile", requireAuth, upsertProfile);
router.get("/workspace/analyses", requireAuth, listAnalyses);
router.post("/workspace/analyses", requireAuth, saveAnalysis);

router.get("/chat/agents", requireAuth, agentCatalog);
router.post("/chat/message", requireAuth, chatMessage);

export default router;
