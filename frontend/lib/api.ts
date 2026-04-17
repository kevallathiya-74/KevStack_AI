import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export function getUserFriendlyError(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = (error.response?.data || {}) as ApiErrorPayload;
    const code = typeof payload.error === "string" ? payload.error : "";
    const message = typeof payload.message === "string" ? payload.message.trim() : "";

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
  hooks: string[];
  cta: string;
  status: string;
  created_at: string;
};

export type DashboardLog = {
  id: number;
  level: string;
  type?: string;
  cause?: string;
  fix_applied?: string;
  created_at: string;
};

export async function fetchDashboard() {
  const { data } = await api.get("/api/dashboard");
  return data as { posts: DashboardPost[]; metrics: DashboardMetric[]; logs: DashboardLog[] };
}

export async function generateContent(topic: string) {
  const { data } = await api.post("/api/content/generate", { topic });
  return data;
}

export async function generateContentFromData() {
  const { data } = await api.post("/api/content/generate-from-data");
  return data;
}

export async function publishPost(post: { content: string }) {
  const { data } = await api.post("/api/publish", post);
  return data as { published: boolean; reason: string };
}

export async function fetchAnalytics() {
  const { data } = await api.get("/api/analytics");
  return data as { metrics: DashboardMetric[] };
}

export async function fetchLogs() {
  const { data } = await api.get("/api/logs");
  return data as { logs: DashboardLog[] };
}
