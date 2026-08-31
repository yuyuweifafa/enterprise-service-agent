'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  TicketStatusBadge,
} from '@/components/ui';
import { apiGet } from '@/lib/client';
import { DOMAIN_LABEL, TICKET_STATUS_LABEL, cn, relativeTime, shortDateTime } from '@/lib/format';
import type { Approval, Domain, Ticket, TicketStatus } from '@/lib/types';

const DOMAINS: Array<Domain | 'ALL'> = ['ALL', 'IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN'];
const STATUSES: Array<TicketStatus | 'ALL'> = [
  'ALL',
  'OPEN',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
];

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<Domain | 'ALL'>('ALL');
  const [status, setStatus] = useState<TicketStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (domain !== 'ALL') params.set('domain', domain);
    if (status !== 'ALL') params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    try {
      const [ticketRes, approvalRes] = await Promise.all([
        apiGet<Ticket[]>(`/api/tickets?${params.toString()}`),
        apiGet<Approval[]>('/api/approvals'),
      ]);
      setTickets(ticketRes.data);
      setApprovals(approvalRes.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, status, q]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q');
    if (initial) {
      setQ(initial);
      setExpanded(initial);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => {
    const open = tickets.filter((t) => t.status === 'OPEN').length;
    const review = tickets.filter((t) => t.status === 'PENDING_REVIEW').length;
    const overdue = tickets.filter(
      (t) => !t.resolvedAt && new Date(t.slaDueAt).getTime() < Date.now(),
    ).length;
    const fromAgent = tickets.filter((t) => t.source === 'AGENT').length;
    return { open, review, overdue, fromAgent };
  }, [tickets]);

  const approvalByTicket = useMemo(() => {
    const byTicketId = new Map<string, Approval>();
    const byApprovalId = new Map<string, Approval>();
    approvals.forEach((a) => {
      byApprovalId.set(a.id, a);
      if (a.ticketId) byTicketId.set(a.ticketId, a);
    });
    return { byTicketId, byApprovalId };
  }, [approvals]);

  const getLinkedApproval = useCallback(
    (ticket: Ticket) =>
      (ticket.linkedApprovalId ? approvalByTicket.byApprovalId.get(ticket.linkedApprovalId) : undefined) ??
      approvalByTicket.byTicketId.get(ticket.id),
    [approvalByTicket],
  );

  return (
    <div>
      <PageHeader
        title="工单中心"
        description="这里是服务事项的总览与追踪视图，用来看每张工单由谁负责、当前状态和 SLA。工单状态不在这里手动推进；高风险事项去人工审核台确认，普通事项由对应部门处理。"
        actions={
          <button type="button" className="btn" onClick={load} disabled={loading}>
            刷新
          </button>
        }
      />

      <section className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">工单中心</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            负责展示所有需要落地处理的事项，重点看状态、处理团队和 SLA。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">人工审核台</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            只处理高风险确认，决定是否允许执行、驳回，或由人工接管。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-xs font-medium text-ink-faint">自动路由</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Agent 会按意图把事项转给具体团队，例如 IT 权限管理组、安全与合规组、HRBP。处理动作不在总览页完成。
          </p>
        </div>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="当前筛选结果" value={String(tickets.length)} hint="条工单" />
        <StatCard label="待受理" value={String(stats.open)} tone={stats.open > 0 ? 'warn' : 'good'} hint="OPEN 状态" />
        <StatCard
          label="待人工确认"
          value={String(stats.review)}
          tone={stats.review > 0 ? 'bad' : 'good'}
          hint="已同步到人工审核台"
        />
        <StatCard
          label="超 SLA"
          value={String(stats.overdue)}
          tone={stats.overdue > 0 ? 'bad' : 'good'}
          hint={`其中 ${stats.fromAgent} 条由 Agent 自动创建`}
        />
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label htmlFor="f-domain" className="label mb-1 block">
            职能域
          </label>
          <select
            id="f-domain"
            className="input w-auto py-1.5 text-sm"
            value={domain}
            onChange={(e) => setDomain(e.target.value as Domain | 'ALL')}
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d === 'ALL' ? '全部' : DOMAIN_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="label mb-1 block">
            状态
          </label>
          <select
            id="f-status"
            className="input w-auto py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | 'ALL')}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? '全部' : TICKET_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="f-q" className="label mb-1 block">
            搜索
          </label>
          <input
            id="f-q"
            className="input py-1.5 text-sm"
            placeholder="工单号 / 标题 / 员工姓名"
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

      <div className="card overflow-hidden">
        {loading ? (
          <div className="px-4">
            <Spinner label="加载工单" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-4">
            <EmptyState title="没有匹配的工单" hint="调整筛选条件，或去对话页触发一个新工单" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th className="table-th">工单号</th>
                  <th className="table-th">标题</th>
                  <th className="table-th">员工</th>
                  <th className="table-th">职能域</th>
                  <th className="table-th">风险</th>
                  <th className="table-th">状态</th>
                  <th className="table-th">处理团队</th>
                  <th className="table-th">SLA</th>
                  <th className="table-th">查看</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const overdue = !t.resolvedAt && new Date(t.slaDueAt).getTime() < Date.now();
                  const isOpen = expanded === t.id;
                  const linkedApproval = getLinkedApproval(t);
                  return (
                    <Fragment key={t.id}>
                      <tr className="border-b border-line/60 hover:bg-surface-2/60">
                        <td className="table-td">
                          <code className="font-mono text-xs text-ink-soft">{t.id}</code>
                          <div className="mt-1 text-[10px] text-ink-faint">
                            {t.source === 'AGENT' ? 'Agent 自动创建' : '人工创建'}
                          </div>
                        </td>
                        <td className="table-td max-w-[260px]">
                          <p className="font-medium text-ink">{t.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{t.description}</p>
                        </td>
                        <td className="table-td whitespace-nowrap">
                          {t.employeeName}
                          <div className="text-[10px] text-ink-faint">{t.employeeId}</div>
                        </td>
                        <td className="table-td">
                          <DomainBadge domain={t.domain} />
                        </td>
                        <td className="table-td">
                          <RiskBadge level={t.riskLevel} />
                          <div className="mt-1 text-[10px] text-ink-faint">{t.priority}</div>
                        </td>
                        <td className="table-td">
                          <TicketStatusBadge status={t.status} />
                          {linkedApproval ? (
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint">
                              <span>审核</span>
                              <ApprovalStatusBadge status={linkedApproval.status} />
                            </div>
                          ) : null}
                        </td>
                        <td className="table-td whitespace-nowrap text-xs">
                          {t.assigneeTeam}
                          {t.assignee ? <div className="text-[10px] text-ink-faint">{t.assignee}</div> : null}
                        </td>
                        <td className="table-td whitespace-nowrap text-xs">
                          <span className={cn(overdue ? 'text-red-600' : 'text-ink-muted')}>
                            {shortDateTime(t.slaDueAt)}
                          </span>
                          <div className="text-[10px] text-ink-faint">
                            创建于 {relativeTime(t.createdAt)}
                          </div>
                        </td>
                        <td className="table-td">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="btn px-2 py-1 text-xs"
                              onClick={() => setExpanded(isOpen ? null : t.id)}
                              aria-expanded={isOpen}
                            >
                              {isOpen ? '收起' : '详情'}
                            </button>
                            {linkedApproval ? (
                              <Link href={`/console/review?q=${linkedApproval.id}`} className="btn px-2 py-1 text-xs">
                                去审核
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {isOpen ? (
                        <tr className="border-b border-line bg-canvas/60">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-3">
                              <div>
                                <h3 className="label mb-2">诉求原文</h3>
                                <p className="rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink-soft">
                                  {t.description}
                                </p>
                                <div className="mt-4 rounded-lg border border-line bg-surface p-3">
                                  <h3 className="label mb-2">路由去向</h3>
                                  <p className="text-sm font-medium text-ink">{t.assigneeTeam}</p>
                                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                                    {linkedApproval?.status === 'PENDING'
                                      ? '这张工单正在等待人工审核，审核通过后会进入该团队执行。'
                                      : '这张工单已进入对应团队的执行队列。'}
                                  </p>
                                  {linkedApproval ? (
                                    <Link href={`/console/review?q=${linkedApproval.id}`} className="btn mt-3 px-2 py-1 text-xs">
                                      查看人工审核任务 {linkedApproval.id}
                                    </Link>
                                  ) : null}
                                </div>
                                {Object.keys(t.slots).length > 0 ? (
                                  <>
                                    <h3 className="label mb-2 mt-4">Agent 抽取的关键信息</h3>
                                    <div className="flex flex-wrap gap-1.5">
                                      {Object.entries(t.slots).map(([k, v]) => (
                                        <span key={k} className="chip border-brand/35 bg-brand-wash text-brand-ink">
                                          {k}={String(v)}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                ) : null}
                              </div>

                              <div>
                                <h3 className="label mb-2">引用的制度依据</h3>
                                {t.citations.length === 0 ? (
                                  <p className="text-xs text-ink-faint">无（当时知识库未命中）</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {t.citations.map((c, i) => (
                                      <li
                                        key={`${c.docId}-${i}`}
                                        className="rounded-lg border border-line bg-surface p-2.5 text-xs"
                                      >
                                        <code className="rounded bg-brand-wash px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
                                          {c.docId}
                                        </code>
                                        <span className="ml-2 text-ink-soft">{c.title}</span>
                                        <div className="mt-1 text-ink-muted">› {c.section}</div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {linkedApproval ? (
                                  <div className="mt-3 rounded-lg border border-line bg-surface p-2.5 text-xs">
                                    <h3 className="label mb-2">人工审核进度</h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <ApprovalStatusBadge status={linkedApproval.status} />
                                      <code className="font-mono text-[11px] text-ink-soft">{linkedApproval.id}</code>
                                      <span className="text-ink-muted">审核团队：{linkedApproval.reviewerTeam}</span>
                                    </div>
                                    {linkedApproval.reviewer ? (
                                      <p className="mt-2 text-ink-muted">
                                        处理人：{linkedApproval.reviewer}
                                        {linkedApproval.decidedAt ? ` · ${shortDateTime(linkedApproval.decidedAt)}` : ''}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                                {t.linkedGapId ? (
                                  <p className="mt-1 text-xs text-ink-soft">
                                    关联知识缺口：
                                    <code className="ml-1 font-mono text-ink-soft">{t.linkedGapId}</code>
                                  </p>
                                ) : null}
                              </div>

                              <div>
                                <h3 className="label mb-2">处理时间线</h3>
                                <ol className="space-y-2">
                                  {t.timeline.map((e, i) => (
                                    <li key={i} className="rounded-lg border border-line bg-surface p-2.5">
                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="chip border-line bg-surface-2 text-ink-soft">
                                          {e.action}
                                        </span>
                                        <span className="text-ink-soft">{e.actor}</span>
                                        <span className="ml-auto text-[10px] text-ink-faint">
                                          {shortDateTime(e.at)}
                                        </span>
                                      </div>
                                      {e.note ? (
                                        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{e.note}</p>
                                      ) : null}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
