'use client';

import { useCallback, useEffect, useState } from 'react';
import { DomainBadge, EmptyState, ErrorNote, PageHeader, Panel, Spinner, StatCard } from '@/components/ui';
import { apiGet, apiPatch } from '@/lib/client';
import { GAP_STATUS_CLASS, GAP_STATUS_LABEL, cn, relativeTime } from '@/lib/format';
import type { Citation, Domain, GapStatus, KnowledgeGap } from '@/lib/types';

interface KnowledgeDocSummary {
  docId: string;
  title: string;
  domain: Domain;
  owner: string;
  version: string;
  updatedAt: string;
  tags: string[];
  keywords: string[];
  filePath: string;
  sections: Array<{ refId: string; section: string; chars: number }>;
}

const GAP_FLOW: Array<{ from: GapStatus; to: GapStatus; label: string }> = [
  { from: 'OPEN', to: 'DRAFTING', label: '开始拟稿' },
  { from: 'DRAFTING', to: 'PUBLISHED', label: '标记已发布' },
  { from: 'OPEN', to: 'IGNORED', label: '忽略' },
];

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocSummary[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('年假能休几天');
  const [hits, setHits] = useState<Citation[] | null>(null);
  const [searchMeta, setSearchMeta] = useState<Record<string, unknown> | null>(null);
  const [searching, setSearching] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, g] = await Promise.all([
        apiGet<KnowledgeDocSummary[]>('/api/knowledge'),
        apiGet<KnowledgeGap[]>('/api/knowledge/gaps'),
      ]);
      setDocs(d.data);
      setGaps(g.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiGet<Citation[]>(`/api/knowledge/search?q=${encodeURIComponent(query.trim())}`);
      setHits(res.data);
      setSearchMeta(res.meta ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const advanceGap = useCallback(
    async (gap: KnowledgeGap, to: GapStatus) => {
      try {
        await apiPatch<KnowledgeGap>(`/api/knowledge/gaps/${gap.id}`, { status: to });
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [load],
  );

  const openGaps = gaps.filter((g) => g.status === 'OPEN').length;
  const totalSections = docs.reduce((s, d) => s + d.sections.length, 0);

  return (
    <div>
      <PageHeader
        title="知识运营"
        description="左边是知识库现状（Markdown 文件 + frontmatter 元数据，直接往 knowledge/ 目录里加文件就会被索引），右边是 Agent 未命中时自动沉淀的待补充知识。这条闭环决定了系统上线后命中率能不能持续往上走。"
        actions={
          <button type="button" className="btn" onClick={load} disabled={loading}>
            重新索引
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="知识文档" value={String(docs.length)} hint={`共 ${totalSections} 个可检索章节`} />
        <StatCard
          label="待补充知识"
          value={String(openGaps)}
          tone={openGaps > 0 ? 'warn' : 'good'}
          hint="Agent 未命中自动沉淀"
        />
        <StatCard
          label="拟稿中"
          value={String(gaps.filter((g) => g.status === 'DRAFTING').length)}
          hint="内容运营处理中"
        />
        <StatCard
          label="已发布"
          value={String(gaps.filter((g) => g.status === 'PUBLISHED').length)}
          tone="good"
          hint="补写后命中率会回升"
        />
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      <div className="mb-4">
        <Panel
          title="检索调试台"
          description="直接调用 GET /api/knowledge/search，看 Agent 眼里的检索结果与相似度分数。调 config/app.config.json 里的 retrieval 参数可以立刻看到效果。"
        >
          <form
            className="mb-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <label htmlFor="kb-q" className="sr-only">
              检索关键词
            </label>
            <input
              id="kb-q"
              className="input flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：生产数据库权限怎么申请"
            />
            <button type="submit" className="btn btn-primary" disabled={searching || !query.trim()}>
              检索
            </button>
          </form>

          {searchMeta ? (
            <p className="mb-3 text-xs text-ink-muted">
              命中 {String(searchMeta.total)} 条 · 最高分 {String(searchMeta.topScore)} · 未过阈值时的原始最高分{' '}
              {String(searchMeta.peekTopScore)}
            </p>
          ) : null}

          {hits === null ? (
            <p className="text-xs text-ink-faint">点「检索」查看结果。</p>
          ) : hits.length === 0 ? (
            <EmptyState
              title="未命中任何片段"
              hint="这种情况下 Agent 会如实告知员工、沉淀知识缺口并转人工，而不是编一个答案"
            />
          ) : (
            <ol className="space-y-2">
              {hits.map((h) => (
                <li key={h.refId} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <code className="rounded bg-brand-wash px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
                      {h.docId}
                    </code>
                    <span className="text-ink-soft">{h.title}</span>
                    <span className="text-ink-faint">›</span>
                    <span className="text-ink-soft">{h.section}</span>
                    <DomainBadge domain={h.domain} />
                    <span className="ml-auto tabular-nums text-emerald-600">{h.score}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">{h.snippet}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="知识库文档" description="knowledge/**/*.md，frontmatter 决定归属域、标签与检索关键词">
          {loading ? (
            <Spinner label="加载知识库" />
          ) : docs.length === 0 ? (
            <EmptyState title="knowledge/ 目录下还没有 Markdown 文档" />
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => {
                const open = expandedDoc === d.docId;
                return (
                  <li key={d.docId} className="rounded-lg border border-line bg-canvas">
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left"
                      onClick={() => setExpandedDoc(open ? null : d.docId)}
                      aria-expanded={open}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                          {d.docId}
                        </code>
                        <span className="text-sm font-medium text-ink">{d.title}</span>
                        <DomainBadge domain={d.domain} />
                        <span className="ml-auto text-[11px] text-ink-faint">
                          v{d.version} · {d.sections.length} 章节
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-faint">
                        归属 {d.owner} · 更新 {d.updatedAt || '未标注'} · {d.filePath}
                      </p>
                    </button>
                    {open ? (
                      <div className="border-t border-line px-3 py-2.5">
                        <div className="mb-2 flex flex-wrap gap-1">
                          {d.tags.map((t) => (
                            <span key={t} className="chip border-line bg-surface-2 text-ink-soft">
                              #{t}
                            </span>
                          ))}
                        </div>
                        <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
                          检索关键词：{d.keywords.join('、') || '未配置'}
                        </p>
                        <ul className="space-y-1">
                          {d.sections.map((s) => (
                            <li key={s.refId} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-ink-soft">› {s.section}</span>
                              <code className="font-mono text-[10px] text-ink-faint">{s.chars} 字</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="未命中沉淀"
          description="Agent 检索不到依据时自动记录；相似问题会累加次数而不是重复建条目"
        >
          {loading ? (
            <Spinner label="加载知识缺口" />
          ) : gaps.length === 0 ? (
            <EmptyState title="暂无知识缺口" hint="去对话页问一个知识库里没有的问题试试" />
          ) : (
            <ul className="space-y-2">
              {gaps.map((g) => (
                <li key={g.id} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <code className="font-mono text-[10px] text-ink-faint">{g.id}</code>
                    <DomainBadge domain={g.domain} />
                    <span className={cn('chip', GAP_STATUS_CLASS[g.status])}>
                      {GAP_STATUS_LABEL[g.status]}
                    </span>
                    <span className="ml-auto tabular-nums text-ink-muted">{g.occurrences} 次</span>
                  </div>
                  <p className="text-sm text-ink">{g.question}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                    建议归属：{g.suggestedOwner} · {g.suggestedDoc}
                  </p>
                  {g.note ? <p className="mt-1 text-[11px] text-ink-muted">{g.note}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-ink-faint">
                      最高分 {g.topScore} · 最近 {relativeTime(g.lastSeenAt)}
                    </span>
                    <div className="ml-auto flex gap-1.5">
                      {GAP_FLOW.filter((f) => f.from === g.status).map((f) => (
                        <button
                          key={f.to}
                          type="button"
                          className="btn px-2 py-1 text-xs"
                          onClick={() => advanceGap(g, f.to)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="怎么往里加知识" description="这是你后续主要的内容工作">
          <ol className="space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>
              1. 在 <code className="font-mono text-ink-soft">knowledge/&lt;域&gt;/</code> 下新建一个 .md 文件，域目录为 it / hr / finance / admin。
            </li>
            <li>
              2. 顶部写 frontmatter：<code className="font-mono text-ink-soft">id / title / domain / owner / version / updatedAt / tags / keywords</code>。
              其中 <code className="font-mono text-ink-soft">keywords</code> 权重最高，把员工的口语化问法写进去最有效（例如「卡丢了」而不是「工牌遗失」）。
            </li>
            <li>
              3. 正文用 <code className="font-mono text-ink-soft">##</code> 二级标题分章节 —— 检索与引用的粒度就是章节，所以标题要写成员工会搜的说法。
            </li>
            <li>4. 保存后点上方「重新索引」（生产环境为进程启动时构建索引），在检索调试台验证能否命中。</li>
            <li>
              5. 如果新知识对应一类新诉求，还要在 <code className="font-mono text-ink-soft">config/intent-rules.json</code> 加意图、在{' '}
              <code className="font-mono text-ink-soft">config/agent-skills.json</code> 挂 Skill。
            </li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
