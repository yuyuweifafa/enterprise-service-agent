import { z } from 'zod';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import { decideApproval, getApproval } from '@/server/repositories/approvals';

/** GET /api/approvals/:id */
export const GET = withErrorHandling(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const approval = await getApproval(id);
    if (!approval) return fail('APPROVAL_NOT_FOUND', `未找到审批任务 ${id}`, 404);
    return ok(approval);
  },
);

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'TAKEN_OVER']),
  reviewer: z.string().min(1).max(64),
  decisionNote: z.string().max(2000).optional(),
});

/**
 * PATCH /api/approvals/:id — 人工确认 / 驳回 / 接管。
 * 决策结果会自动回写到关联工单的状态与处理时间线。
 */
export const PATCH = withErrorHandling(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, patchSchema);
    if (!parsed.ok) return parsed.response;

    const existing = await getApproval(id);
    if (!existing) return fail('APPROVAL_NOT_FOUND', `未找到审批任务 ${id}`, 404);
    if (existing.status !== 'PENDING') {
      return fail('APPROVAL_ALREADY_DECIDED', `审批任务 ${id} 已处理为 ${existing.status}`, 409);
    }

    const approval = await decideApproval(id, parsed.data);
    return ok(approval);
  },
);
