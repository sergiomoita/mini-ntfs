import { Buffer, isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCK_COUNT, BLOCK_SIZE, ROOT_ENTRY_ID, VOLUME_LABEL, VOLUME_VERSION } from './types.js';
import type { FileEntry, VirtualVolume } from './types.js';

export const DEFAULT_VOLUME_PATH = fileURLToPath(new URL('../../../data/volume.json', import.meta.url));

export function loadVolume(volumePath: string): VirtualVolume {
  const contents = readVolumeFile(volumePath);
  if (contents === undefined) {
    const volume = createInitialVolume();
    saveVolume(volumePath, volume);
    return volume;
  }

  try {
    if (!isUtf8(contents)) {
      throw new Error('O arquivo JSON contém bytes UTF-8 inválidos.');
    }
    const volume: unknown = JSON.parse(contents.toString('utf8'));
    if (!hasVolumeShape(volume)) {
      throw new Error('Campos ou dimensões do volume incompatíveis com a versão 1.');
    }

    validateEntries(volume);
    validateBlocks(volume);
    return volume;
  } catch (cause) {
    const detail = cause instanceof Error && !(cause instanceof SyntaxError) ? cause.message : 'JSON inválido.';
    throw new Error(`Volume inválido em "${volumePath}". ${detail}`, { cause });
  }
}

export function saveVolume(volumePath: string, volume: VirtualVolume): void {
  const directory = dirname(volumePath);
  const temporaryPath = join(directory, `.${basename(volumePath)}.${randomUUID()}.tmp`);
  let temporaryCreated = false;

  try {
    mkdirSync(directory, { recursive: true });
    const temporaryFile = openSync(temporaryPath, 'wx');
    temporaryCreated = true;
    try {
      writeFileSync(temporaryFile, `${JSON.stringify(volume, null, 2)}\n`, 'utf8');
    } finally {
      closeSync(temporaryFile);
    }

    replaceVolumeFile(temporaryPath, volumePath);
  } catch (cause) {
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserva o erro que impediu a gravação se a limpeza também falhar.
      }
    }
    throw new Error(`Não foi possível salvar o volume em "${volumePath}".`, { cause });
  }
}

function replaceVolumeFile(temporaryPath: string, volumePath: string): void {
  const maxRetries = 4;
  const retryDelayMs = 25;

  for (let retries = 0; ; retries++) {
    try {
      renameSync(temporaryPath, volumePath);
      return;
    } catch (error) {
      const canRetry = process.platform === 'win32' && error instanceof Error &&
        'code' in error && error.code === 'EPERM';
      if (!canRetry || retries === maxRetries) throw error;

      // Um bloqueio breve no Windows pode impedir a troca do arquivo recém-gravado.
      const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      Atomics.wait(waitCell, 0, 0, retryDelayMs);
    }
  }
}

function readVolumeFile(volumePath: string): Buffer | undefined {
  try {
    // lstat detecta um link existente mesmo se o destino dele estiver ausente.
    if (lstatSync(volumePath, { throwIfNoEntry: false }) === undefined) {
      return undefined;
    }
    return readFileSync(volumePath);
  } catch (cause) {
    throw new Error(`Não foi possível ler o volume em "${volumePath}".`, { cause });
  }
}

function createInitialVolume(): VirtualVolume {
  const timestamp = new Date().toISOString();
  return {
    version: VOLUME_VERSION,
    label: VOLUME_LABEL,
    blockSize: BLOCK_SIZE,
    blockCount: BLOCK_COUNT,
    nextId: ROOT_ENTRY_ID + 1,
    entries: [{
      id: ROOT_ENTRY_ID,
      parentId: null,
      name: 'C:',
      type: 'directory',
      sizeBytes: 0,
      blockIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    bitmap: Array<boolean>(BLOCK_COUNT).fill(false),
    blocks: Array<null>(BLOCK_COUNT).fill(null),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasEntryShape(value: unknown): value is FileEntry {
  return isRecord(value)
    && isPositiveId(value.id)
    && (value.parentId === null || isPositiveId(value.parentId))
    && typeof value.name === 'string'
    && (value.type === 'file' || value.type === 'directory')
    && typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0
    && Array.isArray(value.blockIds) && value.blockIds.every(Number.isInteger)
    && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt);
}

function hasVolumeShape(value: unknown): value is VirtualVolume {
  return isRecord(value)
    && value.version === VOLUME_VERSION
    && typeof value.label === 'string'
    && value.blockSize === BLOCK_SIZE
    && value.blockCount === BLOCK_COUNT
    && isPositiveId(value.nextId)
    && Array.isArray(value.entries) && value.entries.every(hasEntryShape)
    && Array.isArray(value.bitmap) && value.bitmap.length === BLOCK_COUNT
    && value.bitmap.every((bit) => typeof bit === 'boolean')
    && Array.isArray(value.blocks) && value.blocks.length === BLOCK_COUNT
    && value.blocks.every((block) => block === null || typeof block === 'string');
}

function validateEntries(volume: VirtualVolume): void {
  const entriesById = new Map(volume.entries.map((entry) => [entry.id, entry]));
  if (entriesById.size !== volume.entries.length || volume.entries.some((entry) => entry.id >= volume.nextId)) {
    throw new Error('IDs duplicados ou próximo ID inválido na MFT.');
  }

  const root = entriesById.get(ROOT_ENTRY_ID);
  if (!root || root.type !== 'directory' || root.parentId !== null || root.name !== 'C:') {
    throw new Error('A entrada raiz está ausente ou inválida.');
  }

  const siblingNames = new Set<string>();
  const connectedEntries = new Set<number>([ROOT_ENTRY_ID]);
  for (const entry of volume.entries) {
    if (entry.id === ROOT_ENTRY_ID) continue;

    const { name } = entry;
    if (!name || name !== name.trim() || [...name].length > 100 || name === '.' || name === '..' || /[/\\\p{Cc}]/u.test(name)) {
      throw new Error(`Nome inválido na entrada ${entry.id}.`);
    }

    const siblingName = `${entry.parentId}:${name.toLowerCase()}`;
    if (siblingNames.has(siblingName)) {
      throw new Error(`Nome duplicado no diretório da entrada ${entry.id}.`);
    }
    siblingNames.add(siblingName);

    // Reutiliza os caminhos já verificados até a raiz.
    const chain = new Set<number>();
    let current = entry;
    while (!connectedEntries.has(current.id)) {
      if (chain.has(current.id)) {
        throw new Error(`Ciclo de diretórios na entrada ${current.id}.`);
      }
      chain.add(current.id);
      const parent = current.parentId === null ? undefined : entriesById.get(current.parentId);
      if (parent?.type !== 'directory') {
        throw new Error(`Diretório pai inválido para a entrada ${current.id}.`);
      }
      current = parent;
    }
    for (const entryId of chain) {
      connectedEntries.add(entryId);
    }
  }
}

function validateBlocks(volume: VirtualVolume): void {
  const decodedBlocks = volume.blocks.map((block, blockId) => {
    if (volume.bitmap[blockId] !== (block !== null)) {
      throw new Error(`O bitmap não corresponde ao bloco ${blockId}.`);
    }
    if (block === null) return null;

    const bytes = Buffer.from(block, 'base64');
    if (bytes.length === 0 || bytes.length > volume.blockSize || bytes.toString('base64') !== block) {
      throw new Error(`Conteúdo Base64 inválido no bloco ${blockId}.`);
    }
    return bytes;
  });

  const ownedBlocks = new Set<number>();
  for (const entry of volume.entries) {
    if (entry.type === 'directory' && (entry.sizeBytes !== 0 || entry.blockIds.length !== 0)) {
      throw new Error(`O diretório ${entry.id} ocupa blocos de dados.`);
    }
    if (entry.blockIds.length !== Math.ceil(entry.sizeBytes / volume.blockSize)) {
      throw new Error(`A quantidade de blocos da entrada ${entry.id} não corresponde ao tamanho.`);
    }

    const buffers = entry.blockIds.map((blockId, index) => {
      const bytes = decodedBlocks[blockId];
      if (!bytes || ownedBlocks.has(blockId)) {
        throw new Error(`Bloco ${blockId} livre, inexistente ou referenciado mais de uma vez.`);
      }
      const expectedLength = Math.min(volume.blockSize, entry.sizeBytes - index * volume.blockSize);
      if (bytes.length !== expectedLength) {
        throw new Error(`O bloco ${blockId} não corresponde ao tamanho da entrada ${entry.id}.`);
      }
      ownedBlocks.add(blockId);
      return bytes;
    });

    // Um caractere UTF-8 pode começar em um bloco e terminar no seguinte.
    if (!isUtf8(Buffer.concat(buffers))) {
      throw new Error(`Conteúdo UTF-8 inválido na entrada ${entry.id}.`);
    }
  }

  if (ownedBlocks.size !== volume.bitmap.filter(Boolean).length) {
    throw new Error('O bitmap indica blocos ocupados sem uma entrada correspondente.');
  }
}
