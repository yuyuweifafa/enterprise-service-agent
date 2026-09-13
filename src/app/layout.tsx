import type { Metadata } from 'next';
import './globals.css';
import { IdentityProvider } from '@/components/identity';

export const metadata: Metadata = {
  title: '禹钰炜作品集 | AI 解决方案产品经理',
  description:
    '面向 AI 解决方案产品经理和 AI 产品经理岗位的个人作品集，展示 Agent 产品方案、B 端流程抽象、服务闭环和客户方案表达能力。',
};

/**
 * 根布局只负责 html/body 与身份上下文。
 * 具体外壳由两侧各自的 layout 提供：
 *   (employee)/layout.tsx  → 员工端，极简
 *   console/layout.tsx     → 服务台后台，带模块导航
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <IdentityProvider>{children}</IdentityProvider>
      </body>
    </html>
  );
}
