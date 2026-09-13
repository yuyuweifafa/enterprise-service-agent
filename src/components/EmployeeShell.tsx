'use client';

import Link from 'next/link';
import { useIdentity } from './identity';
import { ViewSwitcher } from './ViewSwitcher';

/**
 * 员工端外壳（/chat）。
 *
 * 刻意做得极简：员工只需要一个目标输入框，不该看到人工接入队列、对话记录和看板这些后台模块。
 * 顶部那个「演示身份」下拉框是演示用的身份模拟，真实项目里换成 SSO 会话即可。
 */
export function EmployeeShell({ children }: { children: React.ReactNode }) {
  const { employees, employeeId, setEmployeeId, employee, loading } = useIdentity();

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f7ff]">
      <header className="border-b border-[#dbe5ff] bg-white/95 text-[#172033] shadow-[0_10px_30px_rgba(51,112,255,0.10)] backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3">
          <Link href="/chat" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-xl bg-[linear-gradient(135deg,#3370ff,#7c3aed)] text-sm font-semibold text-white shadow-[0_10px_22px_rgba(51,112,255,0.28)]"
            >
              助
            </span>
            <span>
              <span className="block text-sm font-semibold text-[#172033]">小助个人工作助手</span>
              <span className="block text-[11px] text-[#667085]">一句话交代目标，自动拆解下一步</span>
            </span>
          </Link>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {employee ? (
              <span className="hidden rounded-full bg-[#eef4ff] px-3 py-1.5 text-xs font-medium text-[#3158c9] lg:inline">
                {employee.department} · {employee.title}
              </span>
            ) : null}

            <div className="flex items-center gap-2">
              <label htmlFor="employee-switcher" className="text-xs text-[#667085]">
                演示身份
              </label>
              <select
                id="employee-switcher"
                className="w-auto rounded-xl border border-[#d8e2f5] bg-white px-3 py-1.5 text-xs font-medium text-[#172033] shadow-sm outline-none focus:border-[#3370ff]"
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

      <footer className="border-t border-[#dbe5ff] bg-white px-5 py-3">
        <p className="mx-auto max-w-[1400px] text-[11px] leading-relaxed text-[#64748b]">
          小助会基于公司制度库、个人上下文和可用工具生成结果。涉及生产数据、资金支付、人事敏感事项的请求不会自动执行，会转对应部门人工介入。
        </p>
      </footer>
    </div>
  );
}
