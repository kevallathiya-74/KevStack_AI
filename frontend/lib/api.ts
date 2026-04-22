import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

type ApiErrorPayload = {
  success?: boolean;
  data?: unknown;
  error?:
    | string
    | {
        code?: string;
        message?: string;
      }
    | null;
  message?: string;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error: null | { code?: string; message?: string };
};

function unwrapEnvelope<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    typeof (payload as ApiEnvelope<T>).success === "boolean"
  ) {
    const envelope = payload as ApiEnvelope<T>;
    if (envelope.success) {
      return envelope.data;
    }

    const message = envelope.error?.message || "Request failed.";
    throw new Error(message);
  }

  return payload as T;
}

export function getUserFriendlyError(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = (error.response?.data || {}) as ApiErrorPayload;
    const envelopeError =
      payload.error && typeof payload.error === "object"
        ? payload.error
        : null;
    const code =
      typeof payload.error === "string"
        ? payload.error
        : typeof envelopeError?.code === "string"
          ? envelopeError.code
          : "";
    const message =
      typeof envelopeError?.message === "string"
        ? envelopeError.message.trim()
        : typeof payload.message === "string"
          ? payload.message.trim()
          : "";

    if (code === "validation_error" && message) {
      return message;
    }

    if (code === "rate_limit_exceeded") {
      return "Too many requests right now. Please wait a minute and try again.";
    }

    if (status === 400) {
      return message || "Please review the input and try again.";
    }

    if (status === 401 || status === 403) {
      return "Authorization failed. Please check backend API configuration.";
    }

    if (status === 404) {
      return message || "Requested data was not found.";
    }

    if (status === 429) {
      return "Too many requests right now. Please wait and retry.";
    }

    if (status === 503 || status === 504) {
      return message || "Content service is temporarily unavailable. Please retry shortly.";
    }

    if (status && status >= 500) {
      return "Server is temporarily unavailable. Please try again shortly.";
    }

    if (error.code === "ECONNABORTED") {
      return "The request timed out. Please try again.";
    }

    if (!error.response) {
      return "Cannot connect to backend service. Please ensure the backend server is running.";
    }
  }

  return fallbackMessage;
}

export type DashboardMetric = {
  id: number;
  post_id?: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  created_at: string;
};

export type DashboardPost = {
  id: number;
  topic: string;
  content: string;
  hook?: string;
  hooks: string[];
  cta: string;
  status: string;
  created_at: string;
};

export type ApprovalDraft = DashboardPost;

export type DashboardLog = {
  id: number;
  level: string;
  type?: string;
  message?: string;
  cause?: string;
  fix_applied?: string;
  details?: Record<string, unknown>;
  created_at: string;
};

export type FeedbackLog = {
  id: number;
  title: string;
  description: string;
  status: "success" | "warning" | "error";
  time: string;
  action: string;
  created_at: string;
};

export type GeneratedHookScore = {
  hook: string;
  score: number;
  reasons?: string[];
};

export type GrowthDecision = {
  strategy: string;
  reason: string;
  recommendedTopic: string | null;
};

export type GenerateContentResponse = {
  hook: string;
  content: string;
  cta: string;
  topic: string;
  metrics: {
    impressions: number;
    likes: number;
    comments: number;
  };
  hooks: string[];
  hookScores: GeneratedHookScore[];
  growthDecision?: GrowthDecision | null;
  post: DashboardPost;
};

export type AppSettings = {
  safeMode: boolean;
  publishEnabled: boolean;
  maxPostsPerDay: number;
  maxActionsPerDay: number;
  defaultSchedulerTopic: string;
  huggingFaceConfigured: boolean;
  hasLinkedInCredentials: boolean;
};

export type SubmitMetricInput = {
  post_id: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
};

export async function fetchDashboard() {
  const { data } = await api.get("/api/dashboard");
  return unwrapEnvelope<{ posts: DashboardPost[]; metrics: DashboardMetric[]; logs: DashboardLog[] }>(data);
}

export async function generateContent(topic: string) {
  const { data } = await api.post("/api/content/generate", { topic });
  return unwrapEnvelope<GenerateContentResponse>(data);
}

export async function generateContentFromData() {
  const { data } = await api.post("/api/content/generate-from-data");
  return unwrapEnvelope<
    GenerateContentResponse & {
      source: {
        metricsCount: number;
        postsCount: number;
      };
    }
  >(data);
}

export async function publishPost(post: { content: string }) {
  const { data } = await api.post("/api/publish", post);
  return unwrapEnvelope<{ published: boolean; reason: string; mode?: string; postsToday?: number; actionsToday?: number }>(
    data
  );
}

export async function generateApprovalDraft(topic: string) {
  const { data } = await api.post("/api/approval/generate", { topic });
  return unwrapEnvelope<{ draft: ApprovalDraft; hookScores: GeneratedHookScore[]; flow: string[] }>(data);
}

export async function fetchApprovalDrafts(
  status: "pending_approval" | "approved" | "published" | "rejected" | "pending_manual" | "all" = "pending_approval"
) {
  const { data } = await api.get("/api/approval/drafts", {
    params: { status, limit: 30 },
  });
  return unwrapEnvelope<{ drafts: ApprovalDraft[] }>(data);
}

export async function approveDraft(payload: {
  postId: number;
  approved: true;
  content?: string;
  hook?: string;
  cta?: string;
}) {
  const { data } = await api.post("/api/approval/approve", payload);
  return unwrapEnvelope<{ draft: ApprovalDraft }>(data);
}

export async function rejectDraft(postId: number) {
  const { data } = await api.post("/api/approval/reject", { postId });
  return unwrapEnvelope<{ draft: ApprovalDraft }>(data);
}

export async function publishApprovedDraft(postId: number) {
  const { data } = await api.post("/api/approval/publish", { postId }, { timeout: 120000 });
  return unwrapEnvelope<{ published: boolean; reason: string; mode?: string; draft?: ApprovalDraft; rawReason?: string }>(data);
}

export async function fetchAnalytics() {
  const { data } = await api.get("/api/analytics");
  return unwrapEnvelope<{ metrics: DashboardMetric[] }>(data);
}

export async function fetchLogs() {
  const { data } = await api.get("/api/logs");
  return unwrapEnvelope<{ logs: FeedbackLog[] }>(data);
}

export async function fetchSettings() {
  const { data } = await api.get("/api/settings");
  return unwrapEnvelope<AppSettings>(data);
}

export async function submitMetric(payload: SubmitMetricInput) {
  const { data } = await api.post("/api/metrics", payload);
  return unwrapEnvelope<{ metric: DashboardMetric }>(data);
}
