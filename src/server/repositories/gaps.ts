import type { Domain, GapStatus, KnowledgeGap } from '@/lib/types';
import { domainOwner } from '../config';
import { mutate, readCollection } from '../store';
import { tokenize } from '../knowledge';

export interface RecordGapInput {
  question: string;
  domain: Domain;
  intentId?: string | null;
  employeeId?: string;
  topScore?: number;
}

/** 用 token 交集近似判断是否为同一个知识缺口，避免同义提问反复新建条目 */
function isSimilar(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

export async function listGaps(filter: { status?: GapStatus; domain?: Domain } = {}): Promise<
  KnowledgeGap[]
> {
  const all = await readCollection<KnowledgeGap>('knowledge-gaps');
  return all
    .filter((g) => {
      if (filter.status && g.status !== filter.status) return false;
      if (filter.domain && g.domain !== filter.domain) return false;
      return true;
    })
    .sort((a, b) => b.occurrences - a.occurrences || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function recordGap(input: RecordGapInput): Promise<KnowledgeGap> {
  const now = new Date().toISOString();
  return mutate<KnowledgeGap, KnowledgeGap>('knowledge-gaps', (items) => {
    const existingIdx = items.findIndex((g) => isSimilar(g.question, input.question));
    if (existingIdx !== -1) {
      const prev = items[existingIdx];
      const next: KnowledgeGap = {
        ...prev,
        occurrences: prev.occurrences + 1,
        lastSeenAt: now,
        topScore: Math.max(prev.topScore, input.topScore ?? 0),
        status: prev.status === 'PUBLISHED' ? 'OPEN' : prev.status,
      };
      const copy = [...items];
      copy[existingIdx] = next;
      return { items: copy, result: next };
    }

    const maxSeq = items.reduce((max, g) => {
      const m = /GAP-(\d+)/.exec(g.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const record: KnowledgeGap = {
      id: `GAP-${String(maxSeq + 1).padStart(4, '0')}`,
      question: input.question,
      domain: input.domain,
      intentId: input.intentId ?? null,
      employeeId: input.employeeId,
      occurrences: 1,
      topScore: input.topScore ?? 0,
      status: 'OPEN',
      suggestedOwner: domainOwner(input.domain),
      suggestedDoc: '待内容运营指定归属文档',
      note: '由 Agent 自动沉淀：知识库检索最高分低于阈值。',
      firstSeenAt: now,
      lastSeenAt: now,
    };
    return { items: [...items, record], result: record };
  });
}

export async function updateGap(
  id: string,
  input: { status?: GapStatus; note?: string; suggestedDoc?: string; suggestedOwner?: string },
): Promise<KnowledgeGap | null> {
  return mutate<KnowledgeGap, KnowledgeGap | null>('knowledge-gaps', (items) => {
    const idx = items.findIndex((g) => g.id === id);
    if (idx === -1) return { items, result: null };
    const next: KnowledgeGap = {
      ...items[idx],
      status: input.status ?? items[idx].status,
      note: input.note ?? items[idx].note,
      suggestedDoc: input.suggestedDoc ?? items[idx].suggestedDoc,
      suggestedOwner: input.suggestedOwner ?? items[idx].suggestedOwner,
    };
    const copy = [...items];
    copy[idx] = next;
    return { items: copy, result: next };
  });
}
