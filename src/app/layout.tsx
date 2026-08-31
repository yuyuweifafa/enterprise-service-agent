import type { Metadata } from 'next';
import './globals.css';
import { IdentityProvider } from '@/components/identity';

export const metadata: Metadata = {
  title: '企业内部服务智能体 | IT / HR / 财务 / 行政一站式服务台',
  description:
    '面向员工的企业内部服务 Agent Demo：多意图识别、知识库引用、工单生成、风险分级、人工确认、未命中沉淀与效果看板。',
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
