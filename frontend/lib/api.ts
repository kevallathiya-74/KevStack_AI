import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

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
