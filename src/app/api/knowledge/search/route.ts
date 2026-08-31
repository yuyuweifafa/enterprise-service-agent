import type { Domain } from '@/lib/types';
import { fail, ok, withErrorHandling } from '@/server/http';
import { peekTopScore, searchKnowledge } from '@/server/knowledge';

/**
 * GET /api/knowledge/search?q=年假&domain=HR&topK=4&threshold=0.18
 * 查询知识库（对应工具 kb.search）。返回带来源标识与相似度分数的片段。
 */
export const GET = withErrorHandling(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const q = p.get('q')?.trim();
  if (!q) return fail('INVALID_REQUEST', '缺少查询参数 q', 400);

  const domain = (p.get('domain') as Domain) ?? undefined;
  const topK = p.get('topK') ? Number(p.get('topK')) : undefined;
  const threshold = p.get('threshold') ? Number(p.get('threshold')) : undefined;

  const hits = searchKnowledge(q, { domain, topK, threshold });
  return ok(hits, {
    query: q,
    domain: domain ?? null,
    total: hits.length,
    topScore: hits[0]?.score ?? 0,
    /** 未过阈值时也给出最高分，方便判断是「确实没有」还是「阈值太高」 */
    peekTopScore: peekTopScore(q, domain),
  });
});
