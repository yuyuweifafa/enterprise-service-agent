import type { Domain, GapStatus, RiskLevel, TicketStatus } from './types';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * 标签配色统一走「浅底 + 深字 + 中等边框」三件套：
 * border-<色>-300 / bg-<色>-50 / text-<色>-700，
 * 保证在白底卡片上文字对比度达到 WCAG AA。
 */

export const DOMAIN_LABEL: Record<Domain, string> = {
  IT: 'IT 支持',
  HR: '人力资源',
  FINANCE: '财务',
  ADMIN: '行政',
  UNKNOWN: '待归类',
};

export const DOMAIN_CLASS: Record<Domain, string> = {
  IT: 'border-brand/35 bg-brand-wash text-brand-ink',
  HR: 'border-purple-300 bg-purple-50 text-purple-700',
  FINANCE: 'border-teal-300 bg-teal-50 text-teal-700',
  ADMIN: 'border-amber-300 bg-amber-50 text-amber-700',
  UNKNOWN: 'border-slate-300 bg-slate-100 text-slate-600',
};

/** 看板图表用的十六进制色（SVG 里不能用 Tailwind 类） */
export const DOMAIN_HEX: Record<Domain, string> = {
  IT: '#2d54d6',
  HR: '#7c3aed',
  FINANCE: '#0d9488',
  ADMIN: '#d97706',
  UNKNOWN: '#64748b',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: '低风险 · 自动答复',
  MEDIUM: '中风险 · 需要确认',
  HIGH: '高风险 · 不自动执行',
};

export const RISK_SHORT: Record<RiskLevel, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
};

export const RISK_CLASS: Record<RiskLevel, string> = {
  LOW: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  MEDIUM: 'border-amber-300 bg-amber-50 text-amber-700',
  HIGH: 'border-red-300 bg-red-50 text-red-700',
};

export const RISK_HEX: Record<RiskLevel, string> = {
  LOW: '#16a34a',
  MEDIUM: '#d97706',
  HIGH: '#dc2626',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: '待受理',
  IN_PROGRESS: '处理中',
  PENDING_REVIEW: '待人工接入',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
  REJECTED: '已驳回',
};

export const TICKET_STATUS_CLASS: Record<TicketStatus, string> = {
  OPEN: 'border-sky-300 bg-sky-50 text-sky-700',
  IN_PROGRESS: 'border-brand/35 bg-brand-wash text-brand-ink',
  PENDING_REVIEW: 'border-red-300 bg-red-50 text-red-700',
  RESOLVED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  CLOSED: 'border-slate-300 bg-slate-100 text-slate-600',
  REJECTED: 'border-rose-300 bg-rose-50 text-rose-700',
};

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  OPEN: '待补充',
  DRAFTING: '拟稿中',
  PUBLISHED: '已发布',
  IGNORED: '已忽略',
};

export const GAP_STATUS_CLASS: Record<GapStatus, string> = {
  OPEN: 'border-amber-300 bg-amber-50 text-amber-700',
  DRAFTING: 'border-brand/35 bg-brand-wash text-brand-ink',
  PUBLISHED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  IGNORED: 'border-slate-300 bg-slate-100 text-slate-500',
};

export const ACTION_LABEL: Record<string, string> = {
  answer: '自动答复',
  clarify: '追问补全',
  flow_entry: '流程入口',
  record_gap: '沉淀知识',
  handoff: '转人工',
};

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function money(v: number): string {
  return `¥${v.toLocaleString('zh-CN')}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.round(hour / 24)} 天前`;
}

export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
