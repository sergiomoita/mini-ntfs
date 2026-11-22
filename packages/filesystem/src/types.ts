export const VOLUME_VERSION = 1;
export const VOLUME_LABEL = 'Mini-NTFS';
export const BLOCK_SIZE = 256;
export const BLOCK_COUNT = 64;
export const ROOT_ENTRY_ID = 1;

export type EntryType = 'file' | 'directory';

// Cada índice representa um bloco. false indica livre e true indica ocupado.
export type Bitmap = boolean[];

export interface FileEntry {
  id: number;
  parentId: number | null;
  name: string;
  type: EntryType;
  sizeBytes: number;
  blockIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface VirtualVolume {
  version: typeof VOLUME_VERSION;
  label: string;
  blockSize: number;
  blockCount: number;
  nextId: number;
  entries: FileEntry[];
  bitmap: Bitmap;
  // Cada posição guarda bytes em Base64 ou null para um bloco livre.
  blocks: Array<string | null>;
}

export type EntrySnapshot = Readonly<Omit<FileEntry, 'blockIds'>> & {
  readonly blockIds: readonly number[];
};

export interface VolumeState {
  readonly version: typeof VOLUME_VERSION;
  readonly label: string;
  readonly blockSize: number;
  readonly blockCount: number;
  readonly capacityBytes: number;
  readonly usedBlocks: number;
  readonly freeBlocks: number;
  readonly entries: readonly EntrySnapshot[];
  readonly bitmap: readonly boolean[];
}
