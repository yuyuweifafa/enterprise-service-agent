import type { Employee, PermissionRecord } from '@/lib/types';
import { readCollection } from '../store';

export async function listEmployees(): Promise<Employee[]> {
  return readCollection<Employee>('employees');
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const all = await listEmployees();
  return all.find((e) => e.id === id) ?? null;
}

export async function listPermissions(
  employeeId?: string,
  system?: string,
): Promise<PermissionRecord[]> {
  const all = await readCollection<PermissionRecord>('permissions');
  return all.filter((p) => {
    if (employeeId && p.employeeId !== employeeId) return false;
    if (system && !p.system.toLowerCase().includes(system.toLowerCase())) return false;
    return true;
  });
}
