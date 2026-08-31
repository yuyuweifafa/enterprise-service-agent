import { z } from 'zod';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import { getTicket, updateTicket } from '@/server/repositories/tickets';

/** GET /api/tickets/:id */
export const GET = withErrorHandling(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const ticket = await getTicket(id);
    if (!ticket) return fail('TICKET_NOT_FOUND', `未找到工单 ${id}`, 404);
    return ok(ticket);
  },
);

const patchSchema = z.object({
  status: z
    .enum(['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED', 'CLOSED', 'REJECTED'])
    .optional(),
  assignee: z.string().nullable().optional(),
  assigneeTeam: z.string().optional(),
  note: z.string().max(2000).optional(),
  actor: z.string().max(64).optional(),
});

/** PATCH /api/tickets/:id — 更新工单状态（对应工具 ticket.update_status） */
export const PATCH = withErrorHandling(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, patchSchema);
    if (!parsed.ok) return parsed.response;
    const ticket = await updateTicket(id, parsed.data);
    if (!ticket) return fail('TICKET_NOT_FOUND', `未找到工单 ${id}`, 404);
    return ok(ticket);
  },
);
