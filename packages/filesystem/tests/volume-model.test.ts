import { expect, expectTypeOf, it } from 'vitest';

import {
  BLOCK_COUNT,
  BLOCK_SIZE,
  ROOT_ENTRY_ID,
  VOLUME_LABEL,
  VOLUME_VERSION,
} from '../src/index.js';
import type { FileEntry, VirtualVolume } from '../src/index.js';

it('define a configuração padrão do volume demonstrativo', () => {
  expect(VOLUME_VERSION).toBe(1);
  expect(VOLUME_LABEL).toBe('Mini-NTFS');
  expect(ROOT_ENTRY_ID).toBe(1);
  expect(BLOCK_COUNT).toBe(64);
  expect(BLOCK_SIZE).toBe(256);
  expect(BLOCK_COUNT * BLOCK_SIZE).toBe(16_384);
});

it('define o contrato de tipos da MFT, do bitmap e dos blocos', () => {
  expectTypeOf<VirtualVolume['version']>().toEqualTypeOf<1>();
  expectTypeOf<FileEntry['type']>().toEqualTypeOf<'file' | 'directory'>();
  expectTypeOf<FileEntry['parentId']>().toEqualTypeOf<number | null>();
  expectTypeOf<VirtualVolume['entries']>().toEqualTypeOf<FileEntry[]>();
  expectTypeOf<VirtualVolume['bitmap']>().toEqualTypeOf<boolean[]>();
  expectTypeOf<VirtualVolume['blocks']>().toEqualTypeOf<Array<string | null>>();
});
