import { Router } from 'express';
import type { ErrorRequestHandler, Response } from 'express';

import { FileSystemError } from '@mini-ntfs/filesystem';
import type { FileSystemErrorCode, MiniFileSystem } from '@mini-ntfs/filesystem';

const errorStatuses: Record<FileSystemErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  DUPLICATE_NAME: 409,
  NO_SPACE: 507,
  DIRECTORY_NOT_EMPTY: 400,
  INVALID_MOVE: 400,
  TEXT_NOT_FOUND: 400,
};

export function createApiRouter(filesystem: MiniFileSystem): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    sendSuccess(response, { status: 'ok' });
  });

  router.get('/state', (_request, response) => {
    const state = filesystem.getState();
    const usedBytes = state.usedBlocks * state.blockSize;
    sendSuccess(response, { ...state, usedBytes });
  });

  router.get('/files/:id/content', (request, response) => {
    const id = readPathId(request.params.id);
    sendSuccess(response, { text: filesystem.readFile(id) });
  });

  router.post('/directories', (request, response) => {
    const body = readBody(request.body);
    const parentId = readId(body.parentId, 'parentId');
    const name = readString(body.name, 'name');
    sendSuccess(response, filesystem.createDirectory(parentId, name), 201);
  });

  router.post('/files', (request, response) => {
    const body = readBody(request.body);
    const parentId = readId(body.parentId, 'parentId');
    const name = readString(body.name, 'name');
    sendSuccess(response, filesystem.createFile(parentId, name), 201);
  });

  router.post('/files/:id/append', (request, response) => {
    const id = readPathId(request.params.id);
    const text = readString(readBody(request.body).text, 'text');
    sendSuccess(response, filesystem.appendFile(id, text));
  });

  router.put('/files/:id/content', (request, response) => {
    const id = readPathId(request.params.id);
    const text = readString(readBody(request.body).text, 'text');
    sendSuccess(response, filesystem.overwriteFile(id, text));
  });

  router.post('/files/:id/replace', (request, response) => {
    const id = readPathId(request.params.id);
    const body = readBody(request.body);
    const search = readString(body.search, 'search');
    const replacement = readString(body.replacement, 'replacement');
    sendSuccess(response, filesystem.replaceText(id, search, replacement));
  });

  router.patch('/entries/:id/rename', (request, response) => {
    const id = readPathId(request.params.id);
    const name = readString(readBody(request.body).name, 'name');
    sendSuccess(response, filesystem.renameEntry(id, name));
  });

  router.patch('/entries/:id/move', (request, response) => {
    const id = readPathId(request.params.id);
    const targetParentId = readId(readBody(request.body).targetParentId, 'targetParentId');
    sendSuccess(response, filesystem.moveEntry(id, targetParentId));
  });

  router.delete('/entries/:id', (request, response) => {
    const id = readPathId(request.params.id);
    filesystem.deleteEntry(id);
    sendSuccess(response, { id });
  });

  router.use((_request, response) => {
    sendError(response, 404, 'NOT_FOUND', 'Rota da API não encontrada.');
  });

  return router;
}

export const handleApiError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof FileSystemError) {
    sendError(response, errorStatuses[error.code], error.code, error.message);
    return;
  }

  if (error instanceof Error && 'status' in error && typeof error.status === 'number' &&
      error.status >= 400 && error.status < 500) {
    const message = 'type' in error && error.type === 'entity.too.large'
      ? 'O corpo da requisição excede o tamanho permitido.'
      : 'A URL ou o corpo da requisição está inválido.';
    sendError(response, 400, 'INVALID_INPUT', message);
    return;
  }

  console.error('Erro interno na API do Mini-NTFS.', error);
  sendError(response, 500, 'INTERNAL_ERROR', 'Ocorreu um erro interno na API.');
};

function readPathId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new FileSystemError('INVALID_INPUT', 'O identificador da URL deve ser um inteiro positivo.');
  }
  return readId(Number(value), 'id');
}

function readId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new FileSystemError('INVALID_INPUT', `O campo ${field} deve ser um inteiro positivo.`);
  }
  return value;
}

function readBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new FileSystemError('INVALID_INPUT', 'Envie um objeto JSON no corpo da requisição.');
  }
  return body as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new FileSystemError('INVALID_INPUT', `O campo ${field} deve ser um texto.`);
  }
  return value;
}

function sendSuccess(response: Response, data: unknown, status = 200): void {
  response.status(status).json({ ok: true, data });
}

function sendError(
  response: Response,
  status: number,
  code: FileSystemErrorCode | 'INTERNAL_ERROR',
  message: string,
): void {
  response.status(status).json({ ok: false, error: { code, message } });
}
