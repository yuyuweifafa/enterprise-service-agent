'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Domain, Employee } from '@/lib/types';
import { apiGet } from '@/lib/client';

/**
 * Demo 身份上下文。
 *
 * 刻意区分两种身份，因为这是两个不同的角色（也是两侧产品的分界）：
 *   - employee：员工端（/chat）的「我是谁」，决定档案、权限、风险规则命中情况
 *   - staff：服务后台（/console/*）的「处理人是谁」，写进人工接入记录
 *
 * 真实项目里这两者来自同一套 SSO，但走不同的授权：
 * 员工只能看自己的工单，服务台同事按团队看队列。这里用两个下拉框模拟。
 */

export interface StaffIdentity {
  name: string;
  team: string;
  domain: Extract<Domain, 'IT' | 'ADMIN'>;
}

/** 演示用的服务台同事名单，对应 mock 数据里的处理团队 */
export const STAFF_PRESETS: StaffIdentity[] = [
  { name: '王磊', team: 'IT 权限管理组', domain: 'IT' },
  { name: '刘颖', team: 'IT 桌面运维', domain: 'IT' },
  { name: '钱佳', team: '行政前台', domain: 'ADMIN' },
  { name: '周宁', team: '行政设施组', domain: 'ADMIN' },
];

interface IdentityValue {
  // ── 员工端 ──
  employees: Employee[];
  employeeId: string;
  employee: Employee | null;
  setEmployeeId: (id: string) => void;
  loading: boolean;
  // ── 服务台后台 ──
  staff: StaffIdentity;
  setStaff: (s: StaffIdentity) => void;
}

const DEFAULT_ID = process.env.NEXT_PUBLIC_DEMO_EMPLOYEE_ID ?? 'E1001';
const STORAGE_KEY = 'esa.employeeId';
const STAFF_KEY = 'esa.staff';

const IdentityContext = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeIdState] = useState(DEFAULT_ID);
  const [staff, setStaffState] = useState<StaffIdentity>(STAFF_PRESETS[0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setEmployeeIdState(saved);

    const savedStaff = window.localStorage.getItem(STAFF_KEY);
    if (savedStaff) {
      try {
        const parsed = JSON.parse(savedStaff) as StaffIdentity;
        const valid = STAFF_PRESETS.find((s) => s.name === parsed?.name && s.team === parsed?.team);
        if (valid) setStaffState(valid);
      } catch {
        // 存的内容坏了就用默认值
      }
    }

    apiGet<Employee[]>('/api/employees')
      .then((res) => setEmployees(res.data))
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, []);

  const setEmployeeId = useCallback((id: string) => {
    setEmployeeIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const setStaff = useCallback((s: StaffIdentity) => {
    setStaffState(s);
    window.localStorage.setItem(STAFF_KEY, JSON.stringify(s));
  }, []);

  const value = useMemo<IdentityValue>(
    () => ({
      employees,
      employeeId,
      employee: employees.find((e) => e.id === employeeId) ?? null,
      setEmployeeId,
      loading,
      staff,
      setStaff,
    }),
    [employees, employeeId, setEmployeeId, loading, staff, setStaff],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity 必须在 IdentityProvider 内使用');
  return ctx;
}
