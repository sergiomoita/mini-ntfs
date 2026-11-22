export interface FileEntry {
  id: number;
  parentId: number | null;
  name: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  blockIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface VolumeState {
  version: 1;
  label: string;
  blockSize: number;
  blockCount: number;
  capacityBytes: number;
  usedBytes: number;
  usedBlocks: number;
  freeBlocks: number;
  entries: FileEntry[];
  bitmap: boolean[];
}

export type ApiResponse<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: { code: string; message: string } };
