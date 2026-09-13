import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/ConsoleShell';

export const metadata: Metadata = {
  title: '人工接入后台 | 小助个人工作助手',
  description: '人工接入、对话记录、知识运营与效果看板。面向后台处理人。',
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
