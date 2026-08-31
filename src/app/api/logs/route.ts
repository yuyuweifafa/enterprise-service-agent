import { z } from 'zod';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import { appendLog, listLogs, setFeedback } from '@/server/repositories/logs';

/** GET /api/logs?limit=50 — 查询 Agent 处理日志 */
export const GET = withErrorHandling(async (req: Request) => {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  const logs = await listLogs(Number.isNaN(limit) ? 50 : Math.min(limit, 500));
  return ok(logs, { total: logs.length });
});

const appendSchema = z.object({
  traceId: z.string().min(1),
  sessionId: z.string().min(1),
  employeeId: z.string().min(1),
  question: z.string().min(1).max(2000),
  intents: z
    .array(
      z.object({
        id: z.string().nullable(),
        domain: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN']),
        label: z.string(),
        confidence: z.number(),
      }),
    )
    .default([]),
  knowledgeHit: z.boolean(),
  citationCount: z.number().int().min(0),
  risk: z.object({
    level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    matchedRules: z.array(z.string()).default([]),
  }),
  toolCalls: z
    .array(
      z.object({
        toolId: z.string(),
        status: z.string(),
        durationMs: z.number(),
        summary: z.string().optional(),
      }),
    )
    .default([]),
  actions: z.array(z.string()).default([]),
  resolvedBy: z.enum(['AGENT', 'HUMAN']),
  escalated: z.boolean(),
  latencyMs: z.number().int().min(0),
  feedback: z.enum(['up', 'down']).nullable().default(null),
});

/** POST /api/logs — 记录 Agent 处理日志（对应工具 log.trace） */
export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, appendSchema);
  if (!parsed.ok) return parsed.response;
  const log = await appendLog({ ...parsed.data, createdAt: new Date().toISOString() });
  return ok(log, undefined, 201);
});

const feedbackSchema = z.object({
  traceId: z.string().min(1),
  feedback: z.enum(['up', 'down']).nullable(),
});

/** PATCH /api/logs — 员工对本次回答打分（有用 / 没用），用于看板满意度口径 */
export const PATCH = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, feedbackSchema);
  if (!parsed.ok) return parsed.response;
  const log = await setFeedback(parsed.data.traceId, parsed.data.feedback);
  if (!log) return fail('LOG_NOT_FOUND', `未找到 traceId ${parsed.data.traceId}`, 404);
  return ok(log);
});
