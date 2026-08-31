import { z } from 'zod';
import type { Domain, GapStatus } from '@/lib/types';
import { ok, parseBody, withErrorHandling } from '@/server/http';
import { listGaps, recordGap } from '@/server/repositories/gaps';

/** GET /api/knowledge/gaps?status=OPEN&domain=HR */
export const GET = withErrorHandling(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const gaps = await listGaps({
    status: (p.get('status') as GapStatus) ?? undefined,
    domain: (p.get('domain') as Domain) ?? undefined,
  });
  return ok(gaps, {
    total: gaps.length,
    open: gaps.filter((g) => g.status === 'OPEN').length,
  });
});

const createSchema = z.object({
  question: z.string().min(1).max(2000),
  domain: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN']).default('UNKNOWN'),
  intentId: z.string().nullable().optional(),
  employeeId: z.string().optional(),
  topScore: z.number().min(0).max(1).optional(),
});

/**
 * POST /api/knowledge/gaps — 记录未命中问题（对应工具 kb.record_gap）。
 * 相似问题会累加 occurrences 而不是新建条目。
 */
export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const gap = await recordGap(parsed.data);
  return ok(gap, undefined, 201);
});
