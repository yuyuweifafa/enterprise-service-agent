import { z } from 'zod';
import { fail, ok, parseBody, withErrorHandling } from '@/server/http';
import { updateGap } from '@/server/repositories/gaps';

const patchSchema = z.object({
  status: z.enum(['OPEN', 'DRAFTING', 'PUBLISHED', 'IGNORED']).optional(),
  note: z.string().max(2000).optional(),
  suggestedDoc: z.string().max(400).optional(),
  suggestedOwner: z.string().max(120).optional(),
});

/** PATCH /api/knowledge/gaps/:id — 推进知识缺口状态（待补充 → 拟稿中 → 已发布） */
export const PATCH = withErrorHandling(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, patchSchema);
    if (!parsed.ok) return parsed.response;
    const gap = await updateGap(id, parsed.data);
    if (!gap) return fail('GAP_NOT_FOUND', `未找到知识缺口 ${id}`, 404);
    return ok(gap);
  },
);
