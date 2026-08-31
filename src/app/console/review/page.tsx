'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ApprovalStatusBadge,
  DomainBadge,
  EmptyState,
  ErrorNote,
  PageHeader,
  RiskBadge,
  Spinner,
  StatCard,
} from '@/components/ui';
import { useIdentity } from '@/components/identity';
import { apiGet, apiPatch } from '@/lib/client';
import { cn, relativeTime, shortDateTime } from '@/lib/format';
import type { Approval, ApprovalStatus } from '@/lib/types';

const FILTERS: Array<{ value: ApprovalStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: '待确认' },
  { value: 'ALL', label: '全部' },
  { value: 'APPROVED', label: '已确认' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'TAKEN_OVER', label: '人工接管' },
];

const DECISIONS: Array<{
  value: 'APPROVED' | 'REJECTED' | 'TAKEN_OVER';
  label: string;
  hint: string;
  className: string;
}> = [
  {
    value: 'APPROVED',
    label: '确认执行',
    hint: '认可 Agent 的建议动作，工单转入执行',
    className: 'btn-primary',
  },
  {
    value: 'REJECTED',
    label: '驳回',
    hint: '不予开通 / 不予受理，工单置为已驳回',
    className: 'btn-danger',
  },
  {
    value: 'TAKEN_OVER',
    label: '人工接管',
    hint: '由我线下处理，工单转我名下',
    className: '',
  },
];

export default function ReviewPage() {
  const { staff } = useIdentity();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ApprovalStatus | 'ALL'>('PENDING');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== 'ALL') params.set('status', filter);
    if (q.trim()) params.set('q', q.trim());
    try {
      const res = await apiGet<Approval[]>(`/api/approvals?${params.toString()}`);
      setApprovals(res.data);
      setSelectedId((prev) => (prev && res.data.some((a) => a.id === prev) ? prev : res.data[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q');
    if (initial) {
      setQ(initial);
      setFilter('ALL');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const selected = useMemo(
    () => approvals.find((a) => a.id === selectedId) ?? null,
    [approvals, selectedId],
  );

  const decide = useCallback(
    async (status: 'APPROVED' | 'REJECTED' | 'TAKEN_OVER') => {
      if (!selected) return;
      setSubmitting(true);
      setError(null);
      try {
        await apiPatch<Approval>(`/api/approvals/${selected.id}`, {
          status,
          reviewer: staff.name,
          decisionNote: note.trim() || undefined,
        });
        setNote('');
        await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [selected, staff.name, note, load],
  );

  const pendingCount = approvals.filter((a) => a.status === 'PENDING').length;

  return (
    <div>
      <PageHeader
        title="人工审核台"
        description="这里是高风险事项的执行前确认队列。Agent 会先创建工单并路由到负责团队；如果风险等级需要人工把关，就在这里生成审核任务。审核通过后，关联工单回到对应团队继续处理。"
        actions={
          <div className="flex items-center gap-2">
            {/* 审核人身份由后台顶部的「当前处理人」统一决定，不在页面内重复设置 */}
            <span className="chip border-line bg-surface-2 text-ink-muted">
              当前审核团队 {staff.team} · {staff.name}
            </span>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              刷新
            </button>
          </div>
        }
      />

      <section className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">审核台处理什么</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            只处理需要人工确认的高风险事项，例如生产数据、特权权限、资金或人事敏感请求。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">工单中心处理什么</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            工单中心负责执行和跟进 SLA；审核台只决定这件事能不能继续执行。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">审核后流向</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            确认执行会让关联工单进入处理中；驳回会关闭工单；人工接管会把工单转给当前处理人。
          </p>
        </div>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="待确认"
          value={String(pendingCount)}
          tone={pendingCount > 0 ? 'bad' : 'good'}
          hint="高风险事项排队中"
        />
        <StatCard label="当前列表" value={String(approvals.length)} hint="条审核任务" />
        <StatCard
          label="已驳回"
          value={String(approvals.filter((a) => a.status === 'REJECTED').length)}
          hint="Agent 建议被否决的比例反映规则准确度"
        />
        <StatCard
          label="人工接管"
          value={String(approvals.filter((a) => a.status === 'TAKEN_OVER').length)}
          hint="转为线下一对一处理"
        />
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={cn('btn px-2.5 py-1.5 text-xs', filter === f.value && 'border-brand bg-brand-wash text-brand-ink')}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto min-w-[220px]">
          <label htmlFor="review-q" className="sr-only">
            搜索审核任务
          </label>
          <input
            id="review-q"
            className="input py-1.5 text-sm"
            placeholder="任务号 / 标题 / 员工"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* 列表 */}
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">审核队列</h2>
          </div>
          {loading ? (
            <div className="px-4">
              <Spinner label="加载审核任务" />
            </div>
          ) : approvals.length === 0 ? (
            <div className="p-4">
              <EmptyState title="队列为空" hint="去对话页试一句「帮我开通生产数据库权限」" />
            </div>
          ) : (
            <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
              {approvals.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    aria-current={selectedId === a.id}
                    className={cn(
                      'w-full px-4 py-3 text-left transition',
                      selectedId === a.id ? 'bg-brand-wash' : 'hover:bg-surface-2/60',
                    )}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <RiskBadge level={a.riskLevel} />
                      <DomainBadge domain={a.domain} />
                      <ApprovalStatusBadge status={a.status} />
                    </div>
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {a.employeeName}（{a.employeeId}）· {relativeTime(a.createdAt)}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">审核团队：{a.reviewerTeam}</p>
                    <code className="mt-1 block font-mono text-[10px] text-ink-faint">{a.id}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 详情 */}
        <section className="card overflow-hidden">
          {!selected ? (
            <div className="p-4">
              <EmptyState title="选择左侧任务查看 Agent 的判定依据" hint="审核任务会显示审核团队、关联工单和审核后流向" />
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <RiskBadge level={selected.riskLevel} />
                  <DomainBadge domain={selected.domain} />
                  <ApprovalStatusBadge status={selected.status} />
                  <code className="ml-auto font-mono text-[11px] text-ink-faint">{selected.id}</code>
                </div>
                <h2 className="text-base font-semibold text-ink">{selected.title}</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  申请人 {selected.employeeName}（{selected.employeeId}）· 意图{' '}
                  <code className="font-mono">{selected.intentId ?? 'UNKNOWN'}</code> · 处理团队{' '}
                  {selected.reviewerTeam} · 创建于 {shortDateTime(selected.createdAt)}
                </p>
              </div>

              <div className="space-y-4 p-4">
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <h3 className="label mb-2">流转信息</h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="chip border-line bg-surface text-ink-soft">审核团队：{selected.reviewerTeam}</span>
                    {selected.ticketId ? (
                      <Link href={`/console/tickets?q=${selected.ticketId}`} className="btn px-2 py-1 text-xs">
                        关联工单 {selected.ticketId}
                      </Link>
                    ) : (
                      <span className="chip border-line bg-surface text-ink-faint">无关联工单</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                    这里做的是执行前确认；真正执行仍会回到关联工单和对应团队的处理队列。
                  </p>
                </div>

                {/* 风险依据 */}
                <div>
                  <h3 className="label mb-2">为什么判为 {selected.riskLevel}</h3>
                  <ul className="space-y-1.5">
                    {selected.riskReasons.map((r, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700"
                      >
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 建议动作 */}
                <div>
                  <h3 className="label mb-2">Agent 建议动作</h3>
                  <pre className="whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-xs leading-relaxed text-ink-soft">
                    {selected.suggestedAction}
                  </pre>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* 员工快照 */}
                  <div>
                    <h3 className="label mb-2">员工档案快照</h3>
                    {Object.keys(selected.agentEvidence.employeeSnapshot).length === 0 ? (
                      <p className="text-xs text-ink-faint">无</p>
                    ) : (
                      <dl className="space-y-1 rounded-lg border border-line bg-canvas p-3 text-xs">
                        {Object.entries(selected.agentEvidence.employeeSnapshot).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3">
                            <dt className="text-ink-faint">{k}</dt>
                            <dd className="text-ink-soft">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>

                  {/* 工具调用 */}
                  <div>
                    <h3 className="label mb-2">Agent 查过哪些系统</h3>
                    {selected.agentEvidence.toolCalls.length === 0 ? (
                      <p className="text-xs text-ink-faint">无</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {selected.agentEvidence.toolCalls.map((t, i) => (
                          <li
                            key={`${t.toolId}-${i}`}
                            className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-[11px] text-ink-soft">{t.toolId}</code>
                              <span
                                className={cn(
                                  'chip',
                                  t.status === 'OK'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-300 bg-amber-50 text-amber-700',
                                )}
                              >
                                {t.status}
                              </span>
                              <span className="ml-auto tabular-nums text-[10px] text-ink-faint">
                                {t.durationMs} ms
                              </span>
                            </div>
                            {t.summary ? <p className="mt-1 text-[11px] text-ink-muted">{t.summary}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* 引用 */}
                <div>
                  <h3 className="label mb-2">引用的制度条款</h3>
                  {selected.agentEvidence.citations.length === 0 ? (
                    <p className="text-xs text-ink-faint">无（知识库未命中，需人工判断并补充制度）</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selected.agentEvidence.citations.map((c, i) => (
                        <li
                          key={`${c.docId}-${i}`}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
                        >
                          <code className="rounded bg-brand-wash px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
                            {c.docId}
                          </code>
                          <span className="text-ink-soft">{c.title}</span>
                          <span className="text-ink-faint">›</span>
                          <span className="text-ink-soft">{c.section}</span>
                          <span className="ml-auto tabular-nums text-emerald-600">{c.score}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 决策区 */}
                <div className="rounded-lg border border-line bg-canvas p-3">
                  {selected.status === 'PENDING' ? (
                    <>
                      <h3 className="label mb-2">处理决定</h3>
                      <label htmlFor="decision-note" className="sr-only">
                        处理说明
                      </label>
                      <textarea
                        id="decision-note"
                        className="input mb-3 min-h-[72px] resize-y"
                        placeholder="处理说明（会写入工单时间线，例如：改授数仓脱敏视图，无需生产库权限）"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        {DECISIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            className={cn('btn', d.className)}
                            title={d.hint}
                            disabled={submitting}
                            onClick={() => decide(d.value)}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-ink-faint">
                        决定会同步回写关联工单 {selected.ticketId ?? '（无关联工单）'} 的状态与时间线。
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="label mb-2">处理结果</h3>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <ApprovalStatusBadge status={selected.status} />
                        <span className="text-ink-soft">{selected.reviewer}</span>
                        <span className="text-xs text-ink-faint">
                          {selected.decidedAt ? shortDateTime(selected.decidedAt) : ''}
                        </span>
                      </div>
                      {selected.decisionNote ? (
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{selected.decisionNote}</p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
