'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/format';

/**
 * 员工端 / 服务台后台 的视角切换器。
 *
 * 两侧的 header 都放这个组件，且**不做响应式隐藏** —— 之前把返回入口放在
 * 侧边栏底部，而侧边栏是 hidden md:flex，窗口一窄就整个不渲染，
 * 进了后台就没有路回员工端了。导航的逃生出口不能藏在会消失的容器里。
 *
 * 这是演示用的功能：真实环境里员工看不到后台入口，服务台同事也不需要
 * 在两个身份之间切换，由 SSO 的角色决定落到哪一侧。
 */

const SIDES = [
  { key: 'employee', href: '/chat', label: '员工端' },
  { key: 'console', href: '/console/tickets', label: '服务台后台' },
] as const;

export function ViewSwitcher({ className }: { className?: string }) {
  const pathname = usePathname();
  const current = pathname.startsWith('/console') ? 'console' : 'employee';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="hidden text-[11px] text-ink-faint sm:inline">演示视角</span>
      <div
        className="flex items-center rounded-lg border border-line bg-surface-2 p-0.5"
        role="group"
        aria-label="切换演示视角"
      >
        {SIDES.map((s) => {
          const active = current === s.key;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition',
                active
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
