import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { BLOCK_COUNT, BLOCK_SIZE, MiniFileSystem, ROOT_ENTRY_ID } from '../src/index.js';
import type { FileSystemError, VirtualVolume } from '../src/index.js';

const temporaryRoot = fileURLToPath(new URL('../../../node_modules/.cache/mini-ntfs-tests/', import.meta.url));
let temporaryDirectory: string;
let volumePath: string;

beforeEach(() => {
  mkdirSync(temporaryRoot, { recursive: true });
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'volume-'));
  volumePath = join(temporaryDirectory, 'volume.json');
});

afterEach(() => {
  if (temporaryDirectory && dirname(resolve(temporaryDirectory)) === resolve(temporaryRoot)) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function readSavedVolume(): VirtualVolume {
  return JSON.parse(readFileSync(volumePath, 'utf8')) as VirtualVolume;
}

function expectUnchanged(
  filesystem: MiniFileSystem,
  operation: () => unknown,
  code: FileSystemError['code'],
): void {
  const stateBefore = filesystem.getState();
  const savedBefore = readFileSync(volumePath, 'utf8');

  expect(operation).toThrow(expect.objectContaining({ code }));
  expect(filesystem.getState()).toEqual(stateBefore);
  expect(readFileSync(volumePath, 'utf8')).toBe(savedBefore);
}

it('T01 cria um volume vazio com a entrada raiz e todos os blocos livres', () => {
  expect(existsSync(volumePath)).toBe(false);

  const filesystem = new MiniFileSystem(volumePath);
  const state = filesystem.getState();

  expect(state.entries).toEqual([{
    id: ROOT_ENTRY_ID,
    parentId: null,
    name: 'C:',
    type: 'directory',
    sizeBytes: 0,
    blockIds: [],
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  }]);
  expect(state.bitmap).toEqual(Array(BLOCK_COUNT).fill(false));
  expect(state.freeBlocks).toBe(BLOCK_COUNT);
  expect(state.usedBlocks).toBe(0);
  expect(state.capacityBytes).toBe(BLOCK_COUNT * BLOCK_SIZE);
  expect(state).not.toHaveProperty('blocks');
  expect(readSavedVolume()).toMatchObject({
    nextId: ROOT_ENTRY_ID + 1,
    entries: state.entries,
    bitmap: state.bitmap,
    blocks: Array(BLOCK_COUNT).fill(null),
  });
});

it('T02 cria a.txt vazio e sem reservar blocos', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');

  expect(file).toMatchObject({ name: 'a.txt', type: 'file', sizeBytes: 0, blockIds: [] });
  expect(filesystem.listEntries(ROOT_ENTRY_ID)).toEqual([file]);
  expect(filesystem.readFile(file.id)).toBe('');
  expect(filesystem.getState().usedBlocks).toBe(0);
});

it('T03 sobrescreve a.txt com Olá mundo e conta seus bytes UTF-8', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  const text = 'Olá mundo';

  const written = filesystem.overwriteFile(file.id, text);

  expect(written).toMatchObject({ sizeBytes: 10, blockIds: [0] });
  expect(filesystem.readFile(file.id)).toBe(text);
  expect(filesystem.getState().bitmap[0]).toBe(true);
  expect(readSavedVolume().blocks[0]).toBe(Buffer.from(text, 'utf8').toString('base64'));
});

it('T04 acrescenta texto ao conteúdo anterior', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  filesystem.overwriteFile(file.id, 'Olá mundo');

  filesystem.appendFile(file.id, '!');

  expect(filesystem.readFile(file.id)).toBe('Olá mundo!');
});

it('T05 substitui só a primeira ocorrência literal do trecho', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  filesystem.overwriteFile(file.id, 'axb a.b a.b');

  filesystem.replaceText(file.id, 'a.b', '$&');

  expect(filesystem.readFile(file.id)).toBe('axb $& a.b');
  expectUnchanged(filesystem, () => filesystem.replaceText(file.id, 'ausente', 'x'), 'TEXT_NOT_FOUND');
  expectUnchanged(filesystem, () => filesystem.replaceText(file.id, '', 'x'), 'INVALID_INPUT');
});

it('T06 lê UTF-8 dividido entre blocos não contíguos alocados por first-fit', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const firstFile = filesystem.createFile(ROOT_ENTRY_ID, 'primeiro.txt');
  const blocker = filesystem.createFile(ROOT_ENTRY_ID, 'segundo.txt');
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'multibloco.txt');
  filesystem.overwriteFile(firstFile.id, 'primeiro');
  filesystem.overwriteFile(blocker.id, 'segundo');
  filesystem.deleteEntry(firstFile.id);
  const text = `${'a'.repeat(BLOCK_SIZE - 1)}á${'b'.repeat(BLOCK_SIZE)}`;

  const written = filesystem.overwriteFile(file.id, text);
  const savedBeforeRead = readFileSync(volumePath, 'utf8');

  expect(written.blockIds).toEqual([0, 2, 3]);
  expect(written.sizeBytes).toBe(BLOCK_SIZE * 2 + 1);
  expect(filesystem.readFile(file.id)).toBe(text);
  expect(filesystem.readFile(blocker.id)).toBe('segundo');
  expect(readFileSync(volumePath, 'utf8')).toBe(savedBeforeRead);
});

it('T07 apaga um arquivo e libera todos os seus blocos', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  filesystem.overwriteFile(file.id, 'a'.repeat(BLOCK_SIZE + 1));

  filesystem.deleteEntry(file.id);

  expect(filesystem.listEntries(ROOT_ENTRY_ID)).toEqual([]);
  expect(filesystem.getState().usedBlocks).toBe(0);
  expect(filesystem.getState().bitmap).toEqual(Array(BLOCK_COUNT).fill(false));
  expect(readSavedVolume().blocks).toEqual(Array(BLOCK_COUNT).fill(null));
});

it('T08 renomeia um arquivo preservando seu ID e seus blocos', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  const written = filesystem.overwriteFile(file.id, 'conteúdo');
  const saved = readSavedVolume();

  const renamed = filesystem.renameEntry(file.id, 'novo.txt');

  expect(renamed).toMatchObject({ ...written, name: 'novo.txt', updatedAt: expect.any(String) });
  expect(filesystem.readFile(file.id)).toBe('conteúdo');
  expect(readSavedVolume()).toMatchObject({ bitmap: saved.bitmap, blocks: saved.blocks });
});

it('T09 move um arquivo entre diretórios preservando seu conteúdo', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const source = filesystem.createDirectory(ROOT_ENTRY_ID, 'Origem');
  const destination = filesystem.createDirectory(ROOT_ENTRY_ID, 'Destino');
  const file = filesystem.createFile(source.id, 'a.txt');
  const written = filesystem.overwriteFile(file.id, 'conteúdo');
  const saved = readSavedVolume();

  const moved = filesystem.moveEntry(file.id, destination.id);

  expect(moved).toMatchObject({ ...written, parentId: destination.id, updatedAt: expect.any(String) });
  expect(filesystem.listEntries(source.id)).toEqual([]);
  expect(filesystem.listEntries(destination.id)).toEqual([moved]);
  expect(filesystem.readFile(file.id)).toBe('conteúdo');
  expect(readSavedVolume()).toMatchObject({ bitmap: saved.bitmap, blocks: saved.blocks });
});

it('T10 rejeita nomes duplicados entre irmãos ignorando maiúsculas e minúsculas', () => {
  const filesystem = new MiniFileSystem(volumePath);
  filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');

  expectUnchanged(filesystem, () => filesystem.createDirectory(ROOT_ENTRY_ID, 'A.TXT'), 'DUPLICATE_NAME');
});

it('T11 impede mover um diretório para si mesmo ou um descendente', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const parent = filesystem.createDirectory(ROOT_ENTRY_ID, 'Pai');
  const child = filesystem.createDirectory(parent.id, 'Filho');
  const grandchild = filesystem.createDirectory(child.id, 'Neto');

  expectUnchanged(filesystem, () => filesystem.moveEntry(parent.id, parent.id), 'INVALID_MOVE');
  expectUnchanged(filesystem, () => filesystem.moveEntry(parent.id, grandchild.id), 'INVALID_MOVE');
});

it('T12 rejeita a exclusão de um diretório não vazio', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const directory = filesystem.createDirectory(ROOT_ENTRY_ID, 'Pasta');
  filesystem.createFile(directory.id, 'a.txt');

  expectUnchanged(filesystem, () => filesystem.deleteEntry(directory.id), 'DIRECTORY_NOT_EMPTY');
});

it('T13 preserva o conteúdo original quando uma nova escrita excede a capacidade', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  filesystem.overwriteFile(file.id, 'original');
  const oversizedText = 'x'.repeat(BLOCK_COUNT * BLOCK_SIZE + 1);

  expectUnchanged(filesystem, () => filesystem.overwriteFile(file.id, oversizedText), 'NO_SPACE');
  expect(filesystem.readFile(file.id)).toBe('original');
});

it('T14 carrega metadados, bitmap e conteúdo ao abrir uma nova instância', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const directory = filesystem.createDirectory(ROOT_ENTRY_ID, 'Pasta');
  const file = filesystem.createFile(directory.id, 'a.txt');
  const text = 'Persistência com acentos'.repeat(30);
  filesystem.overwriteFile(file.id, text);
  const savedBeforeReopening = readFileSync(volumePath, 'utf8');

  const reopened = new MiniFileSystem(volumePath);

  expect(reopened.getState()).toEqual(filesystem.getState());
  expect(reopened.readFile(file.id)).toBe(text);
  expect(readFileSync(volumePath, 'utf8')).toBe(savedBeforeReopening);
  expect(reopened.createFile(directory.id, 'b.txt').id).toBe(file.id + 1);
});

it('T15 sobrescreve um arquivo com texto menor e libera os blocos excedentes', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'a.txt');
  filesystem.overwriteFile(file.id, 'x'.repeat(BLOCK_SIZE * BLOCK_COUNT));
  expect(filesystem.getState().freeBlocks).toBe(0);

  const written = filesystem.overwriteFile(file.id, 'curto');

  expect(written.blockIds).toEqual([0]);
  expect(filesystem.readFile(file.id)).toBe('curto');
  expect(filesystem.getState().usedBlocks).toBe(1);
  expect(filesystem.getState().bitmap.slice(1)).toEqual(Array(BLOCK_COUNT - 1).fill(false));
  expect(readSavedVolume().blocks.slice(1)).toEqual(Array(BLOCK_COUNT - 1).fill(null));
});

it('T16 protege a raiz e rejeita criar arquivo em um pai inexistente', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'existente.txt');

  expectUnchanged(filesystem, () => filesystem.deleteEntry(ROOT_ENTRY_ID), 'INVALID_INPUT');
  expectUnchanged(filesystem, () => filesystem.renameEntry(ROOT_ENTRY_ID, 'D:'), 'INVALID_INPUT');
  expectUnchanged(filesystem, () => filesystem.moveEntry(ROOT_ENTRY_ID, ROOT_ENTRY_ID), 'INVALID_MOVE');
  expectUnchanged(filesystem, () => filesystem.createFile(999, 'a.txt'), 'NOT_FOUND');
  expectUnchanged(filesystem, () => filesystem.createFile(file.id, 'a.txt'), 'INVALID_INPUT');
});
