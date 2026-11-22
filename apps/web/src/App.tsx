import { useEffect, useRef, useState } from 'react';

import { api, ApiConnectionError } from './api';
import { ActionDialog } from './components/ActionDialog';
import type { DialogAction } from './components/ActionDialog';
import { FileEditor } from './components/FileEditor';
import { FileExplorer } from './components/FileExplorer';
import { StoragePanel } from './components/StoragePanel';
import type { FileEntry, VolumeState } from './types';

const ROOT_ID = 1;

function directoryPath(entries: readonly FileEntry[], id: number): FileEntry[] {
  const path: FileEntry[] = [];
  let directory = entries.find((entry) => entry.id === id);
  while (directory) {
    path.unshift(directory);
    const parentId = directory.parentId;
    directory = entries.find((entry) => entry.id === parentId);
  }
  return path;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${(bytes / 1024).toLocaleString('pt-BR')} KiB`;
  }
  return `${bytes.toLocaleString('pt-BR')} B`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro ao executar a operação.';
}

async function connect(signal?: AbortSignal): Promise<VolumeState> {
  await api.health(signal);
  return api.getState(signal);
}

export function App() {
  const [volume, setVolume] = useState<VolumeState | null>(null);
  const [currentDirectoryId, setCurrentDirectoryId] = useState(ROOT_ID);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ text: string; savedText: string } | null>(null);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const operationPending = useRef(false);

  const entries = volume?.entries ?? [];
  const selectedEntry = entries.find((entry) => entry.id === selectedId);
  const selectedFile = selectedEntry?.type === 'file' ? selectedEntry : undefined;
  const children = entries
    .filter((entry) => entry.parentId === currentDirectoryId)
    .sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name, 'pt-BR'));
  const path = directoryPath(entries, currentDirectoryId);
  const dirty = editor !== null && editor.text !== editor.savedText;
  const disabled = busy || !volume || needsRefresh;

  useEffect(() => {
    const controller = new AbortController();
    void connect(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) setVolume(state);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setNotice({ type: 'error', message: errorMessage(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  async function run(operation: () => Promise<void>) {
    if (busy || operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      if (error instanceof ApiConnectionError) {
        setNeedsRefresh(true);
        setDialog(null);
      }
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  async function readEditor(fileId: number) {
    const { text } = await api.readFile(fileId);
    setEditor({ text, savedText: text });
  }

  function reloadVolume() {
    void run(async () => {
      setVolume(await connect());
      setNeedsRefresh(false);
      if (selectedFile && !dirty) await readEditor(selectedFile.id);
    });
  }

  function updateVolume(
    operation: () => Promise<unknown>,
    message: string,
    options?: { after?: () => void; readFileId?: number },
  ) {
    void run(async () => {
      await operation();
      setDialog(null);
      options?.after?.();
      if (options?.readFileId !== undefined) setEditor(null);

      // Se a consulta falhar após a gravação, o usuário pode atualizar o estado.
      setNeedsRefresh(true);
      try {
        setVolume(await api.getState());
        setNeedsRefresh(false);
        if (options?.readFileId !== undefined) await readEditor(options.readFileId);
        setNotice({ type: 'success', message });
      } catch (error) {
        if (error instanceof ApiConnectionError) setNeedsRefresh(true);
        setNotice({ type: 'error', message: `${message} ${errorMessage(error)}` });
      }
    });
  }

  function canLeaveEditor(): boolean {
    return !dirty || window.confirm('Descartar as alterações não salvas no editor?');
  }

  function navigate(id: number) {
    if (disabled || id === currentDirectoryId || !canLeaveEditor()) return;
    setCurrentDirectoryId(id);
    setSelectedId(null);
    setEditor(null);
    setNotice(null);
  }

  function selectEntry(entry: FileEntry) {
    if (disabled || entry.id === selectedId || !canLeaveEditor()) return;
    setSelectedId(entry.id);
    setEditor(null);
    setNotice(null);
    if (entry.type === 'file') void run(() => readEditor(entry.id));
  }

  function saveFile() {
    if (disabled || !selectedFile || !editor) return;
    const fileId = selectedFile.id;
    updateVolume(() => api.overwriteFile(fileId, editor.text), 'Arquivo salvo.', { readFileId: fileId });
  }

  function openAction(action: DialogAction) {
    if (disabled) return;
    if ((action === 'append' || action === 'replace') && dirty &&
        !window.confirm('O rascunho será descartado se a operação for concluída. Continuar com o texto salvo?')) return;
    setNotice(null);
    setDialog(action);
  }

  function submitAction(fields: FormData) {
    if (disabled || !dialog) return;
    const name = String(fields.get('name') ?? '');
    if (dialog === 'create-file') {
      updateVolume(() => api.createFile(currentDirectoryId, name), 'Arquivo criado.');
      return;
    }
    if (dialog === 'create-directory') {
      updateVolume(() => api.createDirectory(currentDirectoryId, name), 'Pasta criada.');
      return;
    }
    if (!selectedEntry) return;

    const entryId = selectedEntry.id;
    switch (dialog) {
      case 'rename':
        updateVolume(() => api.renameEntry(entryId, name), 'Nome atualizado.');
        break;
      case 'move': {
        const destinationId = Number(fields.get('targetParentId'));
        updateVolume(() => api.moveEntry(entryId, destinationId), 'Entrada movida.', {
          after: () => setCurrentDirectoryId(destinationId),
        });
        break;
      }
      case 'append': {
        const text = String(fields.get('text') ?? '');
        updateVolume(() => api.appendFile(entryId, text), 'Texto acrescentado.', { readFileId: entryId });
        break;
      }
      case 'replace': {
        const search = String(fields.get('search') ?? '');
        const replacement = String(fields.get('replacement') ?? '');
        updateVolume(() => api.replaceText(entryId, search, replacement), 'Trecho substituído.', { readFileId: entryId });
        break;
      }
    }
  }

  function deleteEntry() {
    if (disabled || !selectedEntry) return;
    const draftWarning = dirty ? ' As alterações do editor serão descartadas.' : '';
    const directoryWarning = selectedEntry.type === 'directory' ? ' Apenas pastas vazias podem ser excluídas.' : '';
    if (!window.confirm(`Excluir “${selectedEntry.name}”?${directoryWarning}${draftWarning}`)) return;
    updateVolume(() => api.deleteEntry(selectedEntry.id), 'Entrada excluída.', {
      after: () => {
        setSelectedId(null);
        setEditor(null);
      },
    });
  }

  const destinations = dialog === 'move' ? entries
    .filter((entry) => entry.type === 'directory' && entry.id !== selectedEntry?.parentId)
    .map((entry) => ({
      id: entry.id,
      label: directoryPath(entries, entry.id).map((directory) => directory.name).join('\\') + '\\',
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR')) : [];
  const connected = volume !== null && !needsRefresh;
  const connection = connected ? 'API conectada' : busy ? 'Carregando volume…' : 'Volume indisponível';
  const connectionClass = connected ? ' is-online' : busy ? '' : ' is-offline';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-content">
          <div className="brand">
            <h1>Mini-NTFS</h1>
            <p>Sistema de arquivos virtual</p>
          </div>
          <span className={`connection-status${connectionClass}`}>
            <span className="connection-dot" aria-hidden="true" />
            {connection}
          </span>
        </div>
      </header>

      <main className="workspace" aria-busy={busy}>
        <dl className="volume-stats" aria-label="Capacidade do volume">
          <div className="stat">
            <dt className="stat-label">Capacidade total</dt>
            <dd className="stat-value">{volume ? formatBytes(volume.capacityBytes) : '—'}</dd>
            {volume && <dd className="stat-detail">{volume.blockCount} blocos de {volume.blockSize} B</dd>}
          </div>
          <div className="stat stat-reserved">
            <dt className="stat-label">Espaço reservado</dt>
            <dd className="stat-value">{volume ? formatBytes(volume.usedBytes) : '—'}</dd>
            {volume && <dd className="stat-detail">{volume.usedBlocks} blocos ocupados</dd>}
          </div>
          <div className="stat">
            <dt className="stat-label">Espaço disponível</dt>
            <dd className="stat-value">{volume ? formatBytes(volume.capacityBytes - volume.usedBytes) : '—'}</dd>
            {volume && <dd className="stat-detail">{volume.freeBlocks} blocos livres</dd>}
          </div>
        </dl>

        <nav className="toolbar" aria-label="Ações de arquivos e pastas">
          <div className="toolbar-group">
            <button className="button-primary" type="button" disabled={disabled} onClick={() => openAction('create-file')}>Novo arquivo</button>
            <button type="button" disabled={disabled} onClick={() => openAction('create-directory')}>Nova pasta</button>
          </div>
          <div className="toolbar-group">
            <button type="button" disabled={disabled || !selectedEntry} onClick={() => openAction('rename')}>Renomear</button>
            <button type="button" disabled={disabled || !selectedEntry} onClick={() => openAction('move')}>Mover</button>
            <button className="button-danger" type="button" disabled={disabled || !selectedEntry} onClick={deleteEntry}>Excluir</button>
          </div>
          {(!volume || needsRefresh) && !busy && (
            <button type="button" onClick={reloadVolume}>Recarregar volume</button>
          )}
        </nav>

        {notice && !dialog && (
          <p className={`notice notice-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.message}</p>
        )}

        <div className="workspace-grid">
          <FileExplorer
            path={path}
            entries={children}
            selectedId={selectedId}
            loading={!volume && busy}
            disabled={disabled}
            onNavigate={navigate}
            onSelect={selectEntry}
          />
          <FileEditor
            file={selectedFile}
            text={editor?.text ?? ''}
            dirty={dirty}
            loading={busy && Boolean(selectedFile) && !editor}
            disabled={disabled}
            available={editor !== null}
            onTextChange={(text) => setEditor((current) => current && { ...current, text })}
            onSave={saveFile}
            onAppend={() => openAction('append')}
            onReplace={() => openAction('replace')}
            onRetry={() => selectedFile && void run(() => readEditor(selectedFile.id))}
          />
          <StoragePanel volume={volume} selectedId={selectedId} />
        </div>
      </main>

      {dialog && (
        <ActionDialog
          action={dialog}
          entryName={selectedEntry?.name}
          destinations={destinations}
          busy={busy}
          error={notice?.type === 'error' ? notice.message : undefined}
          onCancel={() => { setDialog(null); setNotice(null); }}
          onSubmit={submitAction}
        />
      )}
    </div>
  );
}
