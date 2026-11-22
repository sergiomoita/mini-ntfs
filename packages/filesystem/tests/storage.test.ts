import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { MiniFileSystem, ROOT_ENTRY_ID } from '../src/index.js';
import type { VirtualVolume } from '../src/index.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

const temporaryRoot = fileURLToPath(
  new URL('../../../node_modules/.cache/mini-ntfs-tests/', import.meta.url),
);
let temporaryDirectory: string | undefined;
let volumePath: string;

beforeEach(() => {
  mkdirSync(temporaryRoot, { recursive: true });
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'storage-'));
  volumePath = join(temporaryDirectory, 'volume.json');
});

afterEach(() => {
  vi.mocked(renameSync).mockClear();
  if (!temporaryDirectory) return;

  const resolvedDirectory = realpathSync(temporaryDirectory);
  if (dirname(resolvedDirectory) !== realpathSync(temporaryRoot) ||
      !basename(resolvedDirectory).startsWith('storage-')) {
    throw new Error('Diretório temporário de teste inesperado.');
  }

  rmSync(resolvedDirectory, { recursive: true });
  temporaryDirectory = undefined;
});

it('preserva o arquivo quando o JSON do volume é malformado', () => {
  const originalBytes = Buffer.from('{"version": 1, "entries": [', 'utf8');
  writeFileSync(volumePath, originalBytes);

  expect(() => new MiniFileSystem(volumePath)).toThrow(/volume inválido/i);
  expect(readFileSync(volumePath)).toEqual(originalBytes);
});

it('preserva o JSON quando o arquivo contém bytes inválidos em UTF-8', () => {
  new MiniFileSystem(volumePath);
  const originalBytes = readFileSync(volumePath);
  const labelOffset = originalBytes.indexOf('Mini-NTFS');
  expect(labelOffset).toBeGreaterThanOrEqual(0);
  originalBytes[labelOffset] = 0xff;
  writeFileSync(volumePath, originalBytes);

  expect(() => new MiniFileSystem(volumePath)).toThrow(/UTF-8/);
  expect(readFileSync(volumePath)).toEqual(originalBytes);
});

it('preserva o JSON quando o bitmap contradiz os blocos armazenados', () => {
  new MiniFileSystem(volumePath);
  const invalidVolume = JSON.parse(readFileSync(volumePath, 'utf8')) as VirtualVolume;
  invalidVolume.bitmap[0] = true;
  const originalBytes = Buffer.from(JSON.stringify(invalidVolume), 'utf8');
  writeFileSync(volumePath, originalBytes);

  expect(() => new MiniFileSystem(volumePath)).toThrow(/volume inválido/i);
  expect(readFileSync(volumePath)).toEqual(originalBytes);
});

it('preserva o conteúdo de um diretório encontrado no caminho do volume', () => {
  mkdirSync(volumePath);
  const existingFile = join(volumePath, 'existente.txt');
  writeFileSync(existingFile, 'preservar', 'utf8');

  expect(() => new MiniFileSystem(volumePath)).toThrow(/ler o volume/i);
  expect(readFileSync(existingFile, 'utf8')).toBe('preservar');
});

it.runIf(process.platform === 'win32')('repete a troca do arquivo após um EPERM temporário', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'notas.txt');
  const rename = vi.mocked(renameSync);
  rename.mockClear();
  rename.mockImplementationOnce(() => {
    throw Object.assign(new Error('Bloqueio temporário simulado.'), { code: 'EPERM' });
  });

  filesystem.overwriteFile(file.id, 'Texto novo');

  expect(rename.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(rename.mock.calls[0]).toEqual(rename.mock.calls[1]);
  expect(new MiniFileSystem(volumePath).readFile(file.id)).toBe('Texto novo');
  expect(readdirSync(dirname(volumePath))).toEqual(['volume.json']);
});

it('preserva o volume anterior se a troca pelo arquivo temporário falhar', () => {
  const filesystem = new MiniFileSystem(volumePath);
  const file = filesystem.createFile(ROOT_ENTRY_ID, 'notas.txt');
  filesystem.overwriteFile(file.id, 'Texto anterior');
  const originalBytes = readFileSync(volumePath);
  const originalState = filesystem.getState();

  const rename = vi.mocked(renameSync);
  rename.mockClear();
  rename.withImplementation(() => {
    throw Object.assign(new Error('Falha simulada na gravação.'), { code: 'EPERM' });
  }, () => {
    expect(() => filesystem.overwriteFile(file.id, 'Texto novo')).toThrow(/salvar o volume/i);
  });

  expect(rename).toHaveBeenCalledTimes(process.platform === 'win32' ? 5 : 1);
  expect(rename).toHaveBeenLastCalledWith(expect.any(String), volumePath);
  expect(readFileSync(volumePath)).toEqual(originalBytes);
  expect(filesystem.getState()).toEqual(originalState);
  expect(filesystem.readFile(file.id)).toBe('Texto anterior');
  expect(new MiniFileSystem(volumePath).readFile(file.id)).toBe('Texto anterior');
  expect(readdirSync(dirname(volumePath))).toEqual(['volume.json']);

  filesystem.overwriteFile(file.id, 'Texto novo');
  expect(new MiniFileSystem(volumePath).readFile(file.id)).toBe('Texto novo');
});
