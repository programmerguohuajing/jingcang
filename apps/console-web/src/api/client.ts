import {
  ApiResponse,
  CatalogUpdate,
  BrowserInstallJob,
  BrowserInstallRequest,
  BrowserItem,
  CreateSessionRequest,
  SessionResponse,
  AdminUserItem,
  ApprovalRequestItem,
  ApprovalStatus,
  ApprovalType,
  CreateApprovalRequest,
  CreateUserRequest,
  ReviewApprovalRequest,
  UpdateUserPermissionsRequest
} from '@jingcang/contracts';

const API_BASE = '';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
      credentials: 'include'
    });
  } catch (netErr: any) {
    throw new Error('网络连接异常或服务端已断开 (' + (netErr.message || 'Failed to fetch') + ')');
  }

  const json = (await res.json().catch(() => null)) as ApiResponse<T>;
  if (!res.ok || !json || !json.success) {
    throw new Error(json?.error?.message || `请求失败 (HTTP ${res.status})`);
  }
  return json.data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: any }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  logout: () =>
    request('/api/v1/auth/logout', { method: 'POST' }),

  getMe: () =>
    request<{ id: string; username: string; role: string }>('/api/v1/auth/me'),

  getBrowsers: (includeDisabled = false) =>
    request<BrowserItem[]>(includeDisabled ? '/api/v1/admin/browsers' : '/api/v1/browsers'),

  installBrowser: (data: BrowserInstallRequest) =>
    request<BrowserInstallJob>('/api/v1/browser-installs', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  getBrowserInstall: (id: string) =>
    request<BrowserInstallJob>(`/api/v1/browser-installs/${encodeURIComponent(id)}`),

  createSession: (data: CreateSessionRequest) =>
    request<SessionResponse>('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  getSessions: (page = 1, pageSize = 20) =>
    request<{ items: SessionResponse[]; total: number; page: number; totalPages: number }>(
      `/api/v1/sessions?page=${page}&pageSize=${pageSize}`
    ),

  getSession: (id: string) =>
    request<SessionResponse>(`/api/v1/sessions/${id}`),

  terminateSession: (id: string) =>
    request(`/api/v1/sessions/${id}`, { method: 'DELETE' }),

  deleteSession: (id: string) =>
    request(`/api/v1/sessions/${id}?permanent=true`, { method: 'DELETE' }),

  batchDeleteSessions: (ids: string[]) =>
    request<{ total: number; deleted: number; failed: number }>('/api/v1/sessions/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids })
    }),

  extendSession: (id: string, extendMinutes = 30) =>
    request<SessionResponse>(`/api/v1/sessions/${id}/extend`, {
      method: 'POST',
      body: JSON.stringify({ extendMinutes })
    }),

  getViewerToken: (id: string) =>
    request<{ token: string; viewerUrl: string }>(`/api/v1/sessions/${id}/viewer-token`),

  getAdminStatus: () =>
    request<any>('/api/v1/admin/status'),

  triggerCleanup: () =>
    request<any>('/api/v1/admin/cleanup', { method: 'POST' }),

  getAuditEvents: () =>
    request<any[]>('/api/v1/admin/audit-events'),

  updateBrowserCatalog: (id: string, updates: CatalogUpdate) =>
    request<BrowserItem>(`/api/v1/admin/browsers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    }),

  // User Management
  getAdminUsers: () =>
    request<AdminUserItem[]>('/api/v1/admin/users'),

  createAdminUser: (data: CreateUserRequest) =>
    request<AdminUserItem>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  toggleUserStatus: (id: string, enabled: boolean) =>
    request<{ success: boolean }>(`/api/v1/admin/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    }),

  updateUserPermissions: (id: string, data: UpdateUserPermissionsRequest) =>
    request<{ success: boolean }>(`/api/v1/admin/users/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  // Approval Management
  getAdminApprovals: (query?: { status?: ApprovalStatus; type?: ApprovalType }) => {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.type) params.set('type', query.type);
    const qs = params.toString();
    return request<ApprovalRequestItem[]>(`/api/v1/admin/approvals${qs ? `?${qs}` : ''}`);
  },

  reviewApproval: (id: string, data: ReviewApprovalRequest) =>
    request<ApprovalRequestItem>(`/api/v1/admin/approvals/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // User-facing Approval Requests
  submitApprovalRequest: (data: CreateApprovalRequest) =>
    request<ApprovalRequestItem>('/api/v1/approvals', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  getMyApprovals: () =>
    request<ApprovalRequestItem[]>('/api/v1/approvals/my')
};
