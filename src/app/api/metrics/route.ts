import { ok, withErrorHandling } from '@/server/http';
import { computeMetrics } from '@/server/repositories/metrics';

/** GET /api/metrics?days=14 — 效果看板指标（历史聚合 + 实时日志合并计算） */
export const GET = withErrorHandling(async (req: Request) => {
  const raw = Number(new URL(req.url).searchParams.get('days') ?? 14);
  const days = Number.isNaN(raw) ? 14 : Math.min(Math.max(raw, 1), 90);
  const metrics = await computeMetrics(days);
  return ok(metrics);
});
