import axios, { AxiosError, type AxiosRequestConfig } from "axios";

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
        details?: unknown;
      }
    | null;
  message?: string;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error: null | { code?: string; message?: string; details?: unknown };
  meta?: Record<string, unknown> | null;
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

function shouldRetry(error: AxiosError, remainingRetries: number) {
  if (remainingRetries <= 0) {
    return false;
  }

  if (error.code === "ECONNABORTED" || !error.response) {
    return true;
  }

  const status = error.response.status;
  return status === 502 || status === 503 || status === 504;
}

async function requestWithRetry<T>(config: AxiosRequestConfig, retryCount = 1): Promise<T> {
  try {
    const response = await api.request(config);
    return unwrapEnvelope<T>(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && shouldRetry(error, retryCount)) {
      return requestWithRetry<T>(config, retryCount - 1);
    }

    throw error;
  }
}

export function getUserFriendlyError(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = (error.response?.data || {}) as ApiErrorPayload;
    const envelopeError = payload.error && typeof payload.error === "object" ? payload.error : null;
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

    if (code === "linkedin_connect_failed") {
      return "Unable to connect LinkedIn. Please try again.";
    }

    if (code === "linkedin_verification_required") {
      return "LinkedIn asked for verification. Complete it in the opened browser, then click Connect LinkedIn again.";
    }

    if (code === "linkedin_login_timeout") {
      return "LinkedIn login timed out. Please click Connect LinkedIn and finish the login quickly.";
    }

    if (code === "duplicate_post" && message) {
      return message;
    }

    if (code === "rate_limit_exceeded") {
      return "Too many requests right now. Please wait a minute and try again.";
    }

    if (status === 400) {
      return message || "Please review the input and try again.";
    }

    if (status === 401 || status === 403) {
      return message || "Request was rejected.";
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
      return message || "Server is temporarily unavailable. Please try again shortly.";
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
  updated_at?: string;
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

export type LinkedInConnection = {
  connected: boolean;
  profileName: string;
  profileUrl: string;
  connectedAt: string | null;
  lastValidatedAt: string | null;
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
  source?: {
    metricsCount: number;
    postsCount: number;
  };
};

export type AppSettings = {
  safeMode: boolean;
  publishEnabled: boolean;
  maxPostsPerDay: number;
  maxActionsPerDay: number;
  defaultSchedulerTopic: string;
  huggingFaceConfigured: boolean;
  linkedInConnection: LinkedInConnection;
};

export type SubmitMetricInput = {
  post_id: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
};

export async function fetchDashboard() {
  return requestWithRetry<{ posts: DashboardPost[]; metrics: DashboardMetric[]; logs: DashboardLog[] }>(
    {
      method: "GET",
      url: "/api/dashboard",
      params: {
        postLimit: 8,
        metricLimit: 30,
        logLimit: 40,
      },
    },
    1
  );
}

export async function generateContent(topic: string) {
  return requestWithRetry<GenerateContentResponse>({
    method: "POST",
    url: "/api/content/generate",
    data: { topic },
  });
}

export async function generateContentFromData() {
  return requestWithRetry<GenerateContentResponse>({
    method: "POST",
    url: "/api/content/generate-from-data",
  });
}

export async function publishPost(post: { content: string }) {
  return requestWithRetry<{ published: boolean; reason: string; mode?: string; postsToday?: number; actionsToday?: number }>(
    {
      method: "POST",
      url: "/api/publish",
      data: post,
    }
  );
}

export async function generateApprovalDraft(topic: string) {
  return requestWithRetry<{ draft: ApprovalDraft; hookScores: GeneratedHookScore[]; flow: string[] }>({
    method: "POST",
    url: "/api/approval/generate",
    data: { topic },
  });
}

export async function fetchApprovalDrafts(
  status: "pending_approval" | "approved" | "published" | "rejected" | "pending_manual" | "generated" | "all" = "pending_approval"
) {
  return requestWithRetry<{ drafts: ApprovalDraft[] }>(
    {
      method: "GET",
      url: "/api/approval/drafts",
      params: { status, limit: 30 },
    },
    1
  );
}

export async function approveDraft(payload: {
  postId: number;
  approved: true;
  content?: string;
  hook?: string;
  cta?: string;
}) {
  return requestWithRetry<{ draft: ApprovalDraft }>({
    method: "POST",
    url: "/api/approval/approve",
    data: payload,
  });
}

export async function rejectDraft(postId: number) {
  return requestWithRetry<{ draft: ApprovalDraft }>({
    method: "POST",
    url: "/api/approval/reject",
    data: { postId },
  });
}

export async function publishApprovedDraft(postId: number) {
  return requestWithRetry<{ published: boolean; reason: string; mode?: string; draft?: ApprovalDraft; rawReason?: string }>(
    {
      method: "POST",
      url: "/api/approval/publish",
      data: { postId },
      timeout: 120000,
    }
  );
}

export async function fetchAnalytics() {
  return requestWithRetry<{ metrics: DashboardMetric[] }>(
    {
      method: "GET",
      url: "/api/analytics",
      params: { limit: 60, sort: "created_at_desc" },
    },
    1
  );
}

export async function fetchLogs() {
  return requestWithRetry<{ logs: FeedbackLog[] }>(
    {
      method: "GET",
      url: "/api/logs",
      params: { limit: 120, level: "all" },
    },
    1
  );
}

export async function fetchSettings() {
  return requestWithRetry<AppSettings>(
    {
      method: "GET",
      url: "/api/settings",
    },
    1
  );
}

export async function fetchLinkedInStatus() {
  return requestWithRetry<LinkedInConnection>(
    {
      method: "GET",
      url: "/api/linkedin/status",
    },
    1
  );
}

export async function connectLinkedIn() {
  return requestWithRetry<LinkedInConnection>(
    {
      method: "POST",
      url: "/api/linkedin/connect",
      timeout: 240000,
    },
    0
  );
}

export async function disconnectLinkedIn() {
  return requestWithRetry<{ connected: boolean }>(
    {
      method: "POST",
      url: "/api/linkedin/disconnect",
    },
    0
  );
}

export async function submitMetric(payload: SubmitMetricInput) {
  return requestWithRetry<{ metric: DashboardMetric }>({
    method: "POST",
    url: "/api/metrics",
    data: payload,
  });
}
