import { z } from 'zod';
import { runAgentTurn } from '@/agent/pipeline';
import { getConfig } from '@/server/config';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import { getEmployee } from '@/server/repositories/employees';

const schema = z.object({
  message: z.string().min(1, '问题不能为空').max(2000),
  employeeId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
});

/**
 * POST /api/agent/chat
 * Agent 主入口：一次调用完成 意图识别 → 槽位抽取 → 知识检索 → 风险分级 → 工具调用 → 回复合成。
 */
export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const employeeId = parsed.data.employeeId ?? getConfig().app.app.defaultEmployeeId;
  const employee = await getEmployee(employeeId);
  if (!employee) {
    return fail('EMPLOYEE_NOT_FOUND', `未找到工号 ${employeeId} 对应的员工档案`, 404);
  }

  const result = await runAgentTurn({
    message: parsed.data.message,
    employeeId,
    sessionId: parsed.data.sessionId,
  });

  return ok(result, { engine: result.engine, latencyMs: result.latencyMs });
});
