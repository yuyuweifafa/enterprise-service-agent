import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/ConsoleShell';

export const metadata: Metadata = {
  title: '服务台后台 | 企业内部服务智能体',
  description: '工单中心、人工审核、知识运营与效果看板。面向服务台同事。',
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
