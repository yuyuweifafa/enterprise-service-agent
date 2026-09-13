'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/format';
import { STAFF_PRESETS, useIdentity } from './identity';
import { ViewSwitcher } from './ViewSwitcher';

/**
 * 服务台后台外壳（/console/*）。
 *
 * 与员工端分开的原因：这四个模块面向的是服务台同事，
 * 权限边界、导航结构、信息密度都和员工端不一样。
 * 员工不应该看到人工接入队列、会话记录和看板。
 *
 * 真实项目里这一层要加：SSO 登录 + 角色校验（middleware 拦 /console/*）、
 * 按团队过滤队列、操作审计。当前 Demo 未接鉴权，界面上有明确标注。
 */

const NAV = [
  { href: '/console/conversations', label: '对话记录', hint: '一轮会话、目标拆解和结果' },
  { href: '/console/tickets', label: '人工接入', hint: 'IT / 行政进线协同' },
  { href: '/console/knowledge', label: '知识运营', hint: '知识库与未命中沉淀' },
  { href: '/console/settings', label: '设置', hint: '服务范围、Skill 和路由规则' },
  { href: '/console/dashboard', label: '效果看板', hint: '解决率、转人工与缺口' },
];

function StaffSwitcher() {
  const { staff, setStaff } = useIdentity();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-xl border border-[#d8e2f5] bg-[#f8fbff] px-3 py-1.5 text-xs font-semibold text-[#3158c9]">
        {staff.domain === 'IT' ? 'IT 接入岗' : '行政接入岗'}
      </span>
      <label htmlFor="staff-switcher" className="text-xs font-medium text-[#71819a]">
        当前处理人
      </label>
      <select
        id="staff-switcher"
        className="w-auto rounded-xl border border-[#d8e2f5] bg-white px-3 py-1.5 text-xs font-semibold text-[#172033] shadow-sm outline-none focus:border-[#3370ff]"
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

  return (
    <div className="flex min-h-screen bg-[#f5f7fb] text-[#334155]">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[#dbe5ff] bg-white/95 shadow-[18px_0_45px_rgba(51,112,255,0.06)] md:flex">
        <div className="border-b border-[#e6ecfa] px-5 py-5">
          <Link href="/console/conversations" className="block">
            <p className="flex items-center gap-3 text-base font-semibold text-[#172033]">
              <span
                aria-hidden
                className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,#3370ff,#7c3aed)] text-sm font-semibold text-white shadow-[0_14px_30px_rgba(51,112,255,0.28)]"
              >
                台
              </span>
              AI 服务运营后台
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[#71819a]">
              对话理解 / 人工接入
              <br />
              知识沉淀 / 服务设置
            </p>
          </Link>
        </div>

        <nav className="flex-1 space-y-2 p-3" aria-label="后台导航">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-2xl border px-4 py-3 transition',
                  active
                    ? 'border-[#c7d5ff] bg-[linear-gradient(135deg,#eef4ff,#f8fbff)] font-semibold text-[#3158c9] shadow-[0_12px_26px_rgba(51,112,255,0.10)]'
                    : 'border-transparent text-[#52637a] hover:border-[#e6ecfa] hover:bg-[#f8fbff] hover:text-[#172033]',
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {item.label}
                </span>
                <span className="mt-1 block text-[11px] text-[#71819a]">{item.hint}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#e6ecfa] p-4">
          <p className="rounded-2xl bg-[#f8fbff] px-4 py-3 text-[11px] leading-relaxed text-[#71819a]">
            Demo 模式：小助负责理解、回答和分流；后台负责接人工、补知识、配能力、看效果。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#dbe5ff] bg-white/90 px-5 py-3 shadow-[0_10px_30px_rgba(51,112,255,0.06)] backdrop-blur">
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
                  'rounded-full px-3 py-1.5 text-xs',
                  pathname.startsWith(item.href)
                    ? 'bg-[#eef4ff] font-semibold text-[#3158c9]'
                    : 'text-[#64748b]',
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
