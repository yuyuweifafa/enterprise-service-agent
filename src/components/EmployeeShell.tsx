'use client';

import Link from 'next/link';
import { useIdentity } from './identity';
import { ViewSwitcher } from './ViewSwitcher';

/**
 * 员工端外壳（/chat）。
 *
 * 刻意做得极简：员工只需要一个输入框，不该看到工单队列、审核台、看板这些后台模块。
 * 顶部那个「演示身份」下拉框是演示用的身份模拟，真实项目里换成 SSO 会话即可。
 */
export function EmployeeShell({ children }: { children: React.ReactNode }) {
  const { employees, employeeId, setEmployeeId, employee, loading } = useIdentity();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3">
          <Link href="/chat" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-semibold text-white"
            >
              服
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">企业内部服务台</span>
              <span className="block text-[11px] text-ink-faint">IT / HR / 财务 / 行政，一句话办完</span>
            </span>
          </Link>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {employee ? (
              <span className="hidden text-xs text-ink-muted lg:inline">
                {employee.department} · {employee.title}
              </span>
            ) : null}

            <div className="flex items-center gap-2">
              <label htmlFor="employee-switcher" className="text-xs text-ink-faint">
                演示身份
              </label>
              <select
                id="employee-switcher"
                className="input w-auto py-1.5 text-xs"
                value={employeeId}
                disabled={loading}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.level}
                    {e.status === 'PROBATION' ? '（试用期）' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 演示环境才有这个切换器；真实产品里员工看不到后台入口 */}
            <ViewSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">{children}</main>

      <footer className="border-t border-line bg-surface px-5 py-3">
        <p className="mx-auto max-w-[1400px] text-[11px] leading-relaxed text-ink-faint">
          回答基于公司制度库生成并标注来源。涉及生产数据、资金支付、人事敏感事项的请求不会自动执行，会转人工确认。
        </p>
      </footer>
    </div>
  );
}
