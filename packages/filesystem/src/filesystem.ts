import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';

import { DEFAULT_VOLUME_PATH, loadVolume, saveVolume } from './storage.js';
import { ROOT_ENTRY_ID } from './types.js';
import type { EntrySnapshot, EntryType, FileEntry, VirtualVolume, VolumeState } from './types.js';

export type FileSystemErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'DUPLICATE_NAME'
  | 'NO_SPACE'
  | 'DIRECTORY_NOT_EMPTY'
  | 'INVALID_MOVE'
  | 'TEXT_NOT_FOUND';

export class FileSystemError extends Error {
  constructor(readonly code: FileSystemErrorCode, message: string) {
    super(message);
    this.name = 'FileSystemError';
  }
}

export class MiniFileSystem {
  private readonly volumePath: string;
  private volume: VirtualVolume;

  constructor(volumePath = DEFAULT_VOLUME_PATH) {
    this.volumePath = resolve(volumePath);
    this.volume = loadVolume(this.volumePath);
  }

  createDirectory(parentId: number, name: string): FileEntry {
    return this.createEntry(parentId, name, 'directory');
  }

  createFile(parentId: number, name: string): FileEntry {
    return this.createEntry(parentId, name, 'file');
  }

  readFile(fileId: number): string {
    const entry = this.requireFile(fileId);
    const chunks = entry.blockIds.map((blockId) => {
      const block = this.volume.blocks[blockId];
      if (block == null) {
        throw new Error(`O bloco ${blockId} do arquivo ${fileId} está ausente.`);
      }
      return Buffer.from(block, 'base64');
    });

    // Um caractere UTF-8 pode começar em um bloco e terminar em outro.
    return Buffer.concat(chunks).subarray(0, entry.sizeBytes).toString('utf8');
  }

  appendFile(fileId: number, text: string): FileEntry {
    if (typeof text !== 'string') {
      throw new FileSystemError('INVALID_INPUT', 'O conteúdo deve ser um texto.');
    }
    return this.overwriteFile(fileId, this.readFile(fileId) + text);
  }

  overwriteFile(fileId: number, text: string): FileEntry {
    if (typeof text !== 'string') {
      throw new FileSystemError('INVALID_INPUT', 'O conteúdo deve ser um texto.');
    }

    const changedVolume = structuredClone(this.volume);
    const entry = this.requireFile(fileId, changedVolume);
    const { blockSize, blockCount, bitmap, blocks } = changedVolume;
    const bytes = Buffer.from(text, 'utf8');
    const requiredBlocks = Math.ceil(bytes.length / blockSize);
    const blockIds: number[] = [];

    // Liberar primeiro na cópia permite reutilizar os blocos do próprio arquivo.
    this.releaseBlocks(changedVolume, entry.blockIds);
    for (let blockId = 0; blockId < blockCount && blockIds.length < requiredBlocks; blockId++) {
      if (bitmap[blockId]) continue;

      const offset = blockIds.length * blockSize;
      blocks[blockId] = bytes.subarray(offset, offset + blockSize).toString('base64');
      bitmap[blockId] = true;
      blockIds.push(blockId);
    }

    if (blockIds.length < requiredBlocks) {
      throw new FileSystemError('NO_SPACE', 'O volume não tem blocos livres suficientes.');
    }

    entry.blockIds = blockIds;
    entry.sizeBytes = bytes.length;
    entry.updatedAt = new Date().toISOString();
    this.commitChange(changedVolume);
    return structuredClone(entry);
  }

  replaceText(fileId: number, search: string, replacement: string): FileEntry {
    if (typeof search !== 'string' || search.length === 0 || typeof replacement !== 'string') {
      throw new FileSystemError('INVALID_INPUT', 'Informe um trecho de busca e um texto para substituição.');
    }

    const content = this.readFile(fileId);
    const position = content.indexOf(search);
    if (position === -1) {
      throw new FileSystemError('TEXT_NOT_FOUND', 'O trecho de busca não foi encontrado.');
    }

    const newContent = content.slice(0, position) + replacement + content.slice(position + search.length);
    return this.overwriteFile(fileId, newContent);
  }

  deleteEntry(entryId: number): void {
    const entry = this.requireEntry(entryId);
    if (entry.id === ROOT_ENTRY_ID) {
      throw new FileSystemError('INVALID_INPUT', 'O diretório raiz não pode ser excluído.');
    }
    if (entry.type === 'directory' && this.volume.entries.some(({ parentId }) => parentId === entryId)) {
      throw new FileSystemError('DIRECTORY_NOT_EMPTY', 'O diretório precisa estar vazio para ser excluído.');
    }

    const changedVolume = structuredClone(this.volume);
    this.releaseBlocks(changedVolume, entry.blockIds);
    changedVolume.entries = changedVolume.entries.filter(({ id }) => id !== entryId);
    this.commitChange(changedVolume);
  }

  renameEntry(entryId: number, newName: string): FileEntry {
    const changedVolume = structuredClone(this.volume);
    const entry = this.requireEntry(entryId, changedVolume);
    if (entry.parentId === null) {
      throw new FileSystemError('INVALID_INPUT', 'O diretório raiz não pode ser renomeado.');
    }

    entry.name = this.validateName(entry.parentId, newName, entry.id);
    entry.updatedAt = new Date().toISOString();
    this.commitChange(changedVolume);
    return structuredClone(entry);
  }

  moveEntry(entryId: number, targetParentId: number): FileEntry {
    const changedVolume = structuredClone(this.volume);
    const entry = this.requireEntry(entryId, changedVolume);
    if (entry.id === ROOT_ENTRY_ID) {
      throw new FileSystemError('INVALID_MOVE', 'O diretório raiz não pode ser movido.');
    }

    this.requireDirectory(targetParentId);
    this.validateName(targetParentId, entry.name, entry.id);
    if (entry.type === 'directory') {
      this.assertNotMovingIntoDescendant(entry.id, targetParentId);
    }

    entry.parentId = targetParentId;
    entry.updatedAt = new Date().toISOString();
    this.commitChange(changedVolume);
    return structuredClone(entry);
  }

  listEntries(parentId: number): readonly EntrySnapshot[] {
    this.requireDirectory(parentId);
    const children = this.volume.entries.filter((entry) => entry.parentId === parentId);
    children.sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name, 'pt-BR'));
    return structuredClone(children);
  }

  getState(): VolumeState {
    const { version, label, blockSize, blockCount, entries, bitmap } = this.volume;
    const usedBlocks = bitmap.filter(Boolean).length;
    return {
      version,
      label,
      blockSize,
      blockCount,
      capacityBytes: blockSize * blockCount,
      usedBlocks,
      freeBlocks: blockCount - usedBlocks,
      entries: structuredClone(entries),
      bitmap: [...bitmap],
    };
  }

  private createEntry(parentId: number, name: string, type: EntryType): FileEntry {
    this.requireDirectory(parentId);
    const normalizedName = this.validateName(parentId, name);
    const changedVolume = structuredClone(this.volume);
    if (changedVolume.nextId === Number.MAX_SAFE_INTEGER) {
      throw new FileSystemError('NO_SPACE', 'O volume atingiu o limite de identificadores.');
    }

    const now = new Date().toISOString();
    const entry: FileEntry = {
      id: changedVolume.nextId,
      parentId,
      name: normalizedName,
      type,
      sizeBytes: 0,
      blockIds: [],
      createdAt: now,
      updatedAt: now,
    };
    changedVolume.nextId++;
    changedVolume.entries.push(entry);
    this.commitChange(changedVolume);
    return structuredClone(entry);
  }

  private requireEntry(entryId: number, volume = this.volume): FileEntry {
    if (!Number.isSafeInteger(entryId) || entryId < 1) {
      throw new FileSystemError('INVALID_INPUT', 'O identificador deve ser um inteiro positivo.');
    }
    const entry = volume.entries.find(({ id }) => id === entryId);
    if (!entry) {
      throw new FileSystemError('NOT_FOUND', `A entrada ${entryId} não foi encontrada.`);
    }
    return entry;
  }

  private requireDirectory(entryId: number): void {
    if (this.requireEntry(entryId).type !== 'directory') {
      throw new FileSystemError('INVALID_INPUT', `A entrada ${entryId} precisa ser um diretório.`);
    }
  }

  private requireFile(entryId: number, volume = this.volume): FileEntry {
    const entry = this.requireEntry(entryId, volume);
    if (entry.type !== 'file') {
      throw new FileSystemError('INVALID_INPUT', `A entrada ${entryId} precisa ser um arquivo.`);
    }
    return entry;
  }

  private validateName(parentId: number, name: string, excludeId?: number): string {
    if (typeof name !== 'string' || /[\/\\\p{Cc}]/u.test(name)) {
      throw new FileSystemError('INVALID_INPUT', 'O nome contém caracteres inválidos.');
    }
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName === '.' || normalizedName === '..' || [...normalizedName].length > 100) {
      throw new FileSystemError('INVALID_INPUT', 'Informe um nome válido de 1 a 100 caracteres.');
    }

    const lowercaseName = normalizedName.toLowerCase();
    const duplicate = this.volume.entries.some((entry) =>
      entry.parentId === parentId && entry.id !== excludeId && entry.name.toLowerCase() === lowercaseName,
    );
    if (duplicate) {
      throw new FileSystemError('DUPLICATE_NAME', 'Já existe uma entrada com esse nome no diretório.');
    }
    return normalizedName;
  }

  private assertNotMovingIntoDescendant(entryId: number, targetParentId: number): void {
    // Se a origem for ancestral do destino, a nova referência fecharia um ciclo.
    let ancestorId: number | null = targetParentId;
    while (ancestorId !== null) {
      if (ancestorId === entryId) {
        throw new FileSystemError('INVALID_MOVE', 'O diretório não pode ser movido para si mesmo ou para um descendente.');
      }
      ancestorId = this.requireEntry(ancestorId).parentId;
    }
  }

  private releaseBlocks(volume: VirtualVolume, blockIds: number[]): void {
    for (const blockId of blockIds) {
      volume.bitmap[blockId] = false;
      volume.blocks[blockId] = null;
    }
  }

  private commitChange(changedVolume: VirtualVolume): void {
    saveVolume(this.volumePath, changedVolume);
    this.volume = changedVolume;
  }
}
