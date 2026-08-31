'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { cn } from '@/lib/format';
import type { Approval } from '@/lib/types';
import { STAFF_PRESETS, useIdentity } from './identity';
import { ViewSwitcher } from './ViewSwitcher';

/**
 * 服务台后台外壳（/console/*）。
 *
 * 与员工端分开的原因：这四个模块面向的是服务台同事，
 * 权限边界、导航结构、信息密度都和员工端不一样。
 * 员工不应该看到工单队列、审核台和看板。
 *
 * 真实项目里这一层要加：SSO 登录 + 角色校验（middleware 拦 /console/*）、
 * 按团队过滤队列、操作审计。当前 Demo 未接鉴权，界面上有明确标注。
 */

const NAV = [
  { href: '/console/tickets', label: '工单中心', hint: 'Agent 自动生成的工单' },
  { href: '/console/review', label: '人工审核', hint: '高风险事项确认' },
  { href: '/console/knowledge', label: '知识运营', hint: '知识库与未命中沉淀' },
  { href: '/console/dashboard', label: '效果看板', hint: '解决率 / 命中率 / 工时' },
];

function StaffSwitcher() {
  const { staff, setStaff } = useIdentity();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="staff-switcher" className="text-xs text-ink-faint">
        当前处理人
      </label>
      <select
        id="staff-switcher"
        className="input w-auto py-1.5 text-xs"
        value={staff.name}
        onChange={(e) => {
          const hit = STAFF_PRESETS.find((s) => s.name === e.target.value);
          if (hit) setStaff(hit);
        }}
      >
        {STAFF_PRESETS.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} · {s.team}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    apiGet<Approval[]>('/api/approvals?status=PENDING')
      .then((res) => setPending(res.data.length))
      .catch(() => setPending(null));
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line px-5 py-5">
          <Link href="/console/tickets" className="block">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded bg-ink text-[10px] font-semibold text-white"
              >
                台
              </span>
              服务台后台
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
              IT / HR / 财务 / 行政
              <br />
              工单 · 审核 · 知识 · 度量
            </p>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="后台导航">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-2.5 transition',
                  active
                    ? 'bg-brand-wash font-semibold text-brand-ink'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {item.label}
                  {item.href === '/console/review' && pending ? (
                    <span className="chip border-red-300 bg-red-100 text-red-700">{pending}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">{item.hint}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-4">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Demo 模式：本后台未接鉴权。真实环境需 SSO 登录 + 角色校验，并按团队过滤队列。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface/85 px-5 py-3 backdrop-blur">
          {/* 视角切换常驻，不做响应式隐藏：这是回员工端的唯一出口 */}
          <ViewSwitcher />

          {/* 窄屏没有侧边栏，模块导航退到 header 里 */}
          <nav className="flex flex-wrap gap-1 md:hidden" aria-label="后台导航（窄屏）">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2 py-1 text-xs',
                  pathname.startsWith(item.href)
                    ? 'bg-brand-wash font-medium text-brand-ink'
                    : 'text-ink-muted',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <StaffSwitcher />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
