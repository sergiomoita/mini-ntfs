import type { FileEntry } from '../types';

interface FileExplorerProps {
  path: readonly FileEntry[];
  entries: readonly FileEntry[];
  selectedId: number | null;
  loading: boolean;
  disabled: boolean;
  onNavigate: (id: number) => void;
  onSelect: (entry: FileEntry) => void;
}

export function FileExplorer({ path, entries, selectedId, loading, disabled, onNavigate, onSelect }: FileExplorerProps) {
  const parent = path.at(-2);
  const emptyMessage = loading ? 'Carregando volume…' : 'Volume indisponível.';

  return (
    <section className="panel explorer-panel" aria-labelledby="explorer-heading">
      <header className="panel-heading">
        <h2 id="explorer-heading">Explorador</h2>
      </header>

      <div className="panel-body">
        {path.length > 0 && (
          <nav className="explorer-navigation" aria-label="Caminho atual">
            {parent && (
              <button className="button back-button" type="button" disabled={disabled} onClick={() => onNavigate(parent.id)}>
                Voltar
              </button>
            )}
            <ol className="breadcrumb">
              {path.map((directory, index) => {
                const name = directory.id === 1 ? 'C:\\' : directory.name;
                const isCurrent = index === path.length - 1;
                return (
                  <li key={directory.id}>
                    {isCurrent ? (
                      <span aria-current="location">{name}</span>
                    ) : (
                      <button type="button" disabled={disabled} onClick={() => onNavigate(directory.id)}>{name}</button>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {entries.length === 0 ? (
          <p className="empty-state">{path.length > 0 ? 'Esta pasta está vazia.' : emptyMessage}</p>
        ) : (
          <ul className="entry-list">
            {entries.map((entry) => {
              const isDirectory = entry.type === 'directory';
              const isSelected = selectedId === entry.id;
              return (
                <li className={isSelected ? 'entry-row entry-row-selected' : 'entry-row'} key={entry.id}>
                  <button
                    className="entry-button"
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(entry)}
                    onDoubleClick={isDirectory ? () => onNavigate(entry.id) : undefined}
                  >
                    <span className={`entry-icon entry-icon-${isDirectory ? 'folder' : 'file'}`} aria-hidden="true" />
                    <span className="entry-name">{entry.name}</span>
                    <span className="entry-meta" aria-hidden="true">{isDirectory ? 'Pasta' : 'Arquivo'}</span>
                  </button>
                  {isDirectory && (
                    <button
                      className="open-folder"
                      type="button"
                      aria-label={`Abrir pasta ${entry.name}`}
                      disabled={disabled}
                      onClick={() => onNavigate(entry.id)}
                    >
                      <span aria-hidden="true">›</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
