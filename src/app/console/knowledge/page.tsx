'use client';

import { useCallback, useEffect, useState } from 'react';
import { DomainBadge, EmptyState, ErrorNote, PageHeader, Panel, Spinner, StatCard } from '@/components/ui';
import { apiGet } from '@/lib/client';
import type { Citation, Domain } from '@/lib/types';

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

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocSummary[]>([]);
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
      const d = await apiGet<KnowledgeDocSummary[]>('/api/knowledge');
      setDocs(d.data);
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

  const totalSections = docs.reduce((s, d) => s + d.sections.length, 0);
  const domainCount = new Set(docs.map((d) => d.domain)).size;
  const keywordCount = docs.reduce((sum, d) => sum + d.keywords.length, 0);

  return (
    <div>
      <PageHeader
        title="知识运营"
        description="管理小助可以引用的制度口径和常见问题。人工接入中沉淀的处理口径，后续会进入这里统一维护和检索验证。"
        actions={
          <button type="button" className="btn" onClick={load} disabled={loading}>
            重新索引
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="知识文档" value={String(docs.length)} hint={`共 ${totalSections} 个可检索章节`} />
        <StatCard label="覆盖分类" value={String(domainCount)} hint="IT / 行政 / HR / 财务" />
        <StatCard label="检索关键词" value={String(keywordCount)} hint="越贴近员工说法越稳定" />
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      <div className="mb-4">
        <Panel
          title="检索调试台"
          description="用员工的真实问法试跑知识库，看看小助能不能找到可引用的依据。"
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
              命中 {String(searchMeta.total)} 条 · 最相关 {String(searchMeta.topScore)} · 原始相似度{' '}
              {String(searchMeta.peekTopScore)}
            </p>
          ) : null}

          {hits === null ? (
            <p className="text-xs text-ink-faint">点「检索」查看结果。</p>
          ) : hits.length === 0 ? (
            <EmptyState
              title="未命中任何片段"
              hint="这种情况下小助会如实说明未找到依据；如转人工，处理人可在人工接入页沉淀新知识"
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

      <div className="grid gap-4">
        <Panel title="知识库文档" description="按部门维护制度、流程和常见问题；标题和关键词越贴近员工说法，命中越稳定。">
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
      </div>

      <div className="mt-4">
        <Panel title="知识补齐流程" description="把人工处理经验变成下一次可自动回答的知识。">
          <ol className="space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>
              1. 员工问题转人工后，由处理人在人工接入页解决问题。
            </li>
            <li>
              2. 如果处理口径可复用，处理人直接在右侧“沉淀知识库”填写分类、标题和答案。
            </li>
            <li>
              3. 内容运营统一整理为标准知识，补充适用条件、操作步骤、注意事项和兜底方式。
            </li>
            <li>4. 给知识加上员工常用问法，例如“卡丢了”“电脑登不上”“VPN 连不上”，提升检索命中。</li>
            <li>5. 发布前用上面的试跑框验证能否命中，确认小助不会乱答。</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
