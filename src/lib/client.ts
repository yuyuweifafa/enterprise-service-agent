'use client';

/** 浏览器端统一 fetch 封装：拆掉 { data, meta } 外壳，把 { error } 转成异常 */

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiClientError(err?.code ?? 'UNKNOWN', err?.message ?? `请求失败 (${res.status})`, res.status);
  }
  return body as ApiEnvelope<T>;
}

export function apiGet<T>(url: string): Promise<ApiEnvelope<T>> {
  return request<T>(url);
}

export function apiPost<T>(url: string, body: unknown): Promise<ApiEnvelope<T>> {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch<T>(url: string, body: unknown): Promise<ApiEnvelope<T>> {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
}
