import type { ApiResponse, FileEntry, VolumeState } from './types';

export class ApiConnectionError extends Error {
  constructor() {
    super('Não foi possível comunicar com a API. Verifique se o servidor está ativo e tente novamente.');
  }
}

async function request<Data>(path: string, options?: RequestInit): Promise<Data> {
  let response: Response;
  let result: ApiResponse<Data> | null;
  try {
    response = await fetch(`/api${path}`, options);
    result = await response.json() as ApiResponse<Data>;
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiConnectionError();
  }

  if (result?.ok === false) {
    throw new Error(result.error.message);
  }
  if (!response.ok || result?.ok !== true) {
    throw new ApiConnectionError();
  }
  return result.data;
}

function json(method: 'POST' | 'PUT' | 'PATCH', body: object): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  health: (signal?: AbortSignal) => request<{ status: 'ok' }>('/health', { signal }),
  getState: (signal?: AbortSignal) => request<VolumeState>('/state', { signal }),
  readFile: (id: number) => request<{ text: string }>(`/files/${id}/content`),
  createDirectory: (parentId: number, name: string) =>
    request<FileEntry>('/directories', json('POST', { parentId, name })),
  createFile: (parentId: number, name: string) =>
    request<FileEntry>('/files', json('POST', { parentId, name })),
  overwriteFile: (id: number, text: string) =>
    request<FileEntry>(`/files/${id}/content`, json('PUT', { text })),
  appendFile: (id: number, text: string) =>
    request<FileEntry>(`/files/${id}/append`, json('POST', { text })),
  replaceText: (id: number, search: string, replacement: string) =>
    request<FileEntry>(`/files/${id}/replace`, json('POST', { search, replacement })),
  renameEntry: (id: number, name: string) =>
    request<FileEntry>(`/entries/${id}/rename`, json('PATCH', { name })),
  moveEntry: (id: number, targetParentId: number) =>
    request<FileEntry>(`/entries/${id}/move`, json('PATCH', { targetParentId })),
  deleteEntry: (id: number) => request<{ id: number }>(`/entries/${id}`, { method: 'DELETE' }),
};
