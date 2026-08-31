import Link from 'next/link';

/**
 * 入口页：明确这是「两侧产品」而不是一个平铺的后台。
 *
 * 真实环境里不需要这个页面 —— 员工登录后直接落到 /chat，
 * 服务台同事按角色落到 /console。这里做成显式选择是为了演示时讲清角色边界。
 */

const SIDES = [
  {
    href: '/chat',
    badge: '员工端',
    title: '内部服务台',
    desc: '员工用一句话描述诉求，Agent 完成意图拆解、制度检索、风险分级与动作执行。',
    points: ['多意图拆解', '回复标注制度来源', '高风险自动转人工', '答不上来如实说明'],
    cta: '进入对话',
    tone: 'brand' as const,
  },
  {
    href: '/console/tickets',
    badge: '服务台后台',
    title: '工作台',
    desc: '服务台同事处理 Agent 生成的工单、确认高风险事项、补齐知识缺口、看效果度量。',
    points: ['工单中心', '人工审核台', '知识运营', '效果看板'],
    cta: '进入后台',
    tone: 'neutral' as const,
  },
];

export default function EntryPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
      <header className="mb-10">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Demo 环境 · 数据为模拟数据
        </p>
        <h1 className="text-2xl font-semibold text-ink">企业内部服务智能体</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          面向员工的 IT / HR / 财务 / 行政一站式服务台。系统分为员工端与服务台后台两侧，
          面向不同角色、不同权限。选择一侧开始体验。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {SIDES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="card group flex flex-col p-5 transition hover:border-brand/50 hover:shadow-raised"
          >
            <span
              className={
                s.tone === 'brand'
                  ? 'chip mb-3 self-start border-brand/35 bg-brand-wash text-brand-ink'
                  : 'chip mb-3 self-start border-line bg-surface-2 text-ink-muted'
              }
            >
              {s.badge}
            </span>
            <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.desc}</p>
            <ul className="mt-4 space-y-1.5">
              {s.points.map((p) => (
                <li key={p} className="flex items-center gap-2 text-xs text-ink-soft">
                  <span aria-hidden className="text-brand">
                    ·
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            <span className="mt-5 text-sm font-medium text-brand-ink group-hover:underline">
              {s.cta} →
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-ink-faint">
        两侧目前共用同一套 mock API 且未接鉴权。真实环境需要 SSO 登录 +
        中间件拦截 <code className="font-mono">/console/*</code> 做角色校验，并按团队过滤工单队列。
      </p>
    </main>
  );
}
