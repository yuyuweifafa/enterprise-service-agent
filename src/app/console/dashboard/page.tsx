'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarList, Donut, LineTrend, StackedBars, TargetBar } from '@/components/charts';
import { EmptyState, ErrorNote, PageHeader, Panel, Spinner, StatCard } from '@/components/ui';
import { apiGet } from '@/lib/client';
import {
  DOMAIN_HEX,
  DOMAIN_LABEL,
  GAP_STATUS_CLASS,
  GAP_STATUS_LABEL,
  RISK_CLASS,
  RISK_HEX,
  TICKET_STATUS_LABEL,
  cn,
  money,
  ms,
  pct,
} from '@/lib/format';
import type { AgentLog, MetricsSummary } from '@/lib/types';


export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, l] = await Promise.all([
        apiGet<MetricsSummary>(`/api/metrics?days=${days}`),
        apiGet<AgentLog[]>('/api/logs?limit=12'),
      ]);
      setMetrics(m.data);
      setLogs(l.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="效果看板"
        description="看小助首答解决、流程入口和人工接入情况。实时部分来自员工端产生的真实处理日志。"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="range" className="text-xs text-ink-muted">
              统计区间
            </label>
            <select
              id="range"
              className="input w-auto py-1.5 text-xs"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>近 7 天</option>
              <option value={14}>近 14 天</option>
              <option value={30}>近 30 天</option>
            </select>
            <button type="button" className="btn" onClick={load} disabled={loading}>
              刷新
            </button>
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      {loading && !metrics ? (
        <Spinner label="计算指标" />
      ) : !metrics ? (
        <EmptyState title="暂无指标数据" />
      ) : (
        <div className="space-y-4">
          {/* 核心指标 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="自助解决率"
              value={pct(metrics.rates.resolutionRate)}
              tone={metrics.rates.resolutionRate >= metrics.targets.resolutionRate ? 'good' : 'warn'}
              hint={`目标 ${pct(metrics.targets.resolutionRate, 0)} · ${metrics.totals.autoResolved}/${metrics.totals.conversations} 次`}
            />
            <StatCard
              label="知识命中率"
              value={pct(metrics.rates.knowledgeHitRate)}
              tone={metrics.rates.knowledgeHitRate >= metrics.targets.knowledgeHitRate ? 'good' : 'warn'}
              hint={`目标 ${pct(metrics.targets.knowledgeHitRate, 0)} · 未命中会自动沉淀`}
            />
            <StatCard
              label="转人工率"
              value={pct(metrics.rates.escalationRate)}
              tone={metrics.rates.escalationRate <= metrics.targets.escalationRate ? 'good' : 'bad'}
              hint={`目标 ≤ ${pct(metrics.targets.escalationRate, 0)} · 只统计 IT / 行政接入`}
            />
            <StatCard
              label="平均响应时间"
              value={ms(metrics.responseTime.avgLatencyMs)}
              tone={metrics.responseTime.avgLatencyMs <= metrics.targets.firstResponseMs ? 'good' : 'warn'}
              hint={`P90 ${ms(metrics.responseTime.p90LatencyMs)} · 人工基线 ${metrics.responseTime.baselineMinutes} 分钟`}
            />
            <StatCard
              label="节省工时"
              value={`${metrics.savings.savedHours} h`}
              tone="good"
              hint={`折合 ${money(metrics.savings.savedCostCNY)} · 约 ${metrics.savings.fteEquivalent} 人力当量`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 趋势 */}
            <Panel
              title="会话量与自助解决趋势"
              description={`${metrics.range.from} ~ ${metrics.range.to}，共 ${metrics.range.days} 天`}
              className="lg:col-span-2"
            >
              <StackedBars
                ariaLabel="每日自动解决与转人工数量堆叠柱状图"
                series={metrics.trend.map((t) => ({
                  label: t.date.slice(5),
                  primary: t.autoResolved,
                  secondary: t.escalated,
                }))}
              />
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="label mb-2">平均响应时间走势</h3>
                <LineTrend
                  ariaLabel="平均响应时间折线图"
                  height={110}
                  color="#14b8a6"
                  series={metrics.trend.map((t) => ({ label: t.date.slice(5), value: t.avgLatencyMs }))}
                  valueFormatter={(v) => ms(v)}
                />
              </div>
            </Panel>

            {/* 目标达成 */}
            <Panel title="目标达成度" description="灰线为目标值">
              <div className="space-y-4">
                <TargetBar
                  label="自助解决率"
                  value={metrics.rates.resolutionRate}
                  target={metrics.targets.resolutionRate}
                  formatter={(v) => pct(v, 0)}
                />
                <TargetBar
                  label="知识命中率"
                  value={metrics.rates.knowledgeHitRate}
                  target={metrics.targets.knowledgeHitRate}
                  formatter={(v) => pct(v, 0)}
                />
                <TargetBar
                  label="转人工率（越低越好）"
                  value={metrics.rates.escalationRate}
                  target={metrics.targets.escalationRate}
                  formatter={(v) => pct(v, 0)}
                  higherIsBetter={false}
                />
                <TargetBar
                  label="平均响应（越低越好）"
                  value={metrics.responseTime.avgLatencyMs}
                  target={metrics.targets.firstResponseMs}
                  formatter={(v) => ms(v)}
                  higherIsBetter={false}
                />
              </div>

              <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-muted">流程入口触发</span>
                  <span className="tabular-nums text-ink-soft">{metrics.totals.flowEntries} 次</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">人工接入</span>
                  <span className="tabular-nums text-ink-soft">{metrics.totals.humanHandoffs || metrics.totals.escalated} 条</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">当前待接入</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      metrics.pendingReview > 0 ? 'text-red-600' : 'text-emerald-600',
                    )}
                  >
                    {metrics.pendingReview} 条
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="风险分级分布" description="低风险自动答复 / 中风险提醒确认 / 高风险不自动执行">
              <Donut
                ariaLabel="风险等级分布环形图"
                centerLabel="高风险占比"
                centerValue={pct(
                  metrics.riskDistribution.find((r) => r.level === 'HIGH')?.share ?? 0,
                  1,
                )}
                segments={metrics.riskDistribution.map((r) => ({
                  label: `${r.level === 'LOW' ? '低' : r.level === 'MEDIUM' ? '中' : '高'}风险`,
                  value: r.count,
                  color: RISK_HEX[r.level],
                }))}
              />
            </Panel>

            <Panel title="职能域分布" description="不同部门的会话量与人工接入量">
              <BarList
                ariaLabel="各职能域会话量"
                items={metrics.byDomain.map((d) => ({
                  label: DOMAIN_LABEL[d.domain],
                  value: d.conversations,
                  share: d.share,
                  hint: `${d.tickets} 次需跟进`,
                  color: DOMAIN_HEX[d.domain],
                }))}
              />
            </Panel>

            <Panel title="跟进状态分布" description="需要人工或流程承接的事项状态">
              <BarList
                ariaLabel="跟进状态分布"
                items={(() => {
                  const total = metrics.handoffStatus.reduce((s, x) => s + x.count, 0) || 1;
                  return metrics.handoffStatus
                    .filter((s) => s.count > 0)
                    .map((s) => ({
                      label: TICKET_STATUS_LABEL[s.status],
                      value: s.count,
                      share: s.count / total,
                      color: s.status === 'PENDING_REVIEW' ? '#ef4444' : '#4f7cff',
                    }));
                })()}
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="待补充知识 Top 5" description="知识库未命中沉淀，按出现次数排序">
              {metrics.topGaps.length === 0 ? (
                <EmptyState title="暂无知识缺口" />
              ) : (
                <ol className="space-y-2">
                  {metrics.topGaps.map((g) => (
                    <li key={g.id} className="rounded-lg border border-line bg-canvas p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <code className="font-mono text-[10px] text-ink-muted">{g.id}</code>
                        <span className="chip border-line bg-surface-2 text-ink-soft">
                          {DOMAIN_LABEL[g.domain]}
                        </span>
                        <span className={cn('chip', GAP_STATUS_CLASS[g.status])}>
                          {GAP_STATUS_LABEL[g.status]}
                        </span>
                        <span className="ml-auto tabular-nums text-ink-muted">{g.occurrences} 次</span>
                      </div>
                      <p className="text-sm text-ink-soft">{g.question}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel title="最近处理日志" description="每次对话的意图、风险、工具调用与耗时">
              {logs.length === 0 ? (
                <EmptyState title="暂无处理日志" />
              ) : (
                <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                  {logs.map((l) => (
                    <li key={l.id} className="rounded-lg border border-line bg-canvas p-3">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <code className="font-mono text-ink-faint">{l.traceId}</code>
                        <span
                          className={cn('chip', RISK_CLASS[l.risk.level])}
                        >
                          {l.risk.level}
                        </span>
                        {l.knowledgeHit ? (
                          <span className="chip border-line bg-surface-2 text-ink-soft">
                            引用 {l.citationCount}
                          </span>
                        ) : (
                          <span className="chip border-amber-300 bg-amber-50 text-amber-700">未命中</span>
                        )}
                        <span className="chip border-line bg-surface-2 text-ink-soft">
                          {l.escalated ? '转人工' : 'Agent 闭环'}
                        </span>
                        <span className="ml-auto tabular-nums text-ink-faint">{ms(l.latencyMs)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-ink-soft">{l.question}</p>
                      <p className="mt-1 text-[11px] text-ink-faint">
                        {l.intents.map((i) => `${i.label}(${i.confidence})`).join(' · ')}
                        {l.risk.matchedRules.length > 0 ? ` · 规则 ${l.risk.matchedRules.join('/')}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="口径说明" description="这些指标用来说明小助上线后如何被持续运营。">
            <ul className="grid gap-2 text-xs leading-relaxed text-ink-soft md:grid-cols-2">
              <li>
                <strong className="text-ink-soft">自助解决率</strong> = 未转 IT / 行政人工的会话 / 总会话。HR / 财务办理只算流程入口。
              </li>
              <li>
                <strong className="text-ink-soft">知识命中率</strong> = 至少检索到 1 条超过相似度阈值片段的会话 / 总会话。阈值配置在 retrieval.scoreThreshold。
              </li>
              <li>
                <strong className="text-ink-soft">转人工率</strong> = 进入 IT / 行政人工接入的会话 / 总会话。
              </li>
              <li>
                <strong className="text-ink-soft">平均响应时间</strong> = 从收到问题到产出回复的服务端耗时，按会话量加权。
              </li>
              <li>
                <strong className="text-ink-soft">节省工时</strong> = 各职能域自动解决量 × 原本人工平均处理时长，再折算成小时。
              </li>
              <li>
                <strong className="text-ink-soft">节省成本</strong> = 节省工时 × metrics.hourlyCostCNY（默认 85 元/小时）。
              </li>
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
