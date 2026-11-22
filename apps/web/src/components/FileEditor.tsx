import type { FileEntry } from '../types';

interface FileEditorProps {
  file: FileEntry | undefined;
  text: string;
  dirty: boolean;
  loading: boolean;
  disabled: boolean;
  available: boolean;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onAppend: () => void;
  onReplace: () => void;
  onRetry: () => void;
}

export function FileEditor({
  file,
  text,
  dirty,
  loading,
  disabled,
  available,
  onTextChange,
  onSave,
  onAppend,
  onReplace,
  onRetry,
}: FileEditorProps) {
  return (
    <section className="panel editor-panel" aria-labelledby="editor-heading" aria-busy={loading}>
      <header className="panel-heading">
        <h2 id="editor-heading">Editor de texto</h2>
        {file && <p className="editor-file-name">{file.name}</p>}
      </header>

      <div className="panel-body">
        {!file && <p className="empty-state">Selecione um arquivo para abrir no editor.</p>}
        {file && loading && <p className="empty-state" role="status">Carregando conteúdo…</p>}
        {file && !loading && !available && (
          <div className="empty-state">
            <p>O conteúdo do arquivo está indisponível.</p>
            <button className="button" type="button" disabled={disabled} onClick={onRetry}>Tentar abrir novamente</button>
          </div>
        )}
        {file && !loading && available && (
          <>
            <label className="field-label" htmlFor="file-content">Conteúdo do arquivo</label>
            <textarea
              className="editor-text"
              id="file-content"
              rows={12}
              value={text}
              readOnly={disabled}
              onChange={(event) => onTextChange(event.currentTarget.value)}
            />
            <div className="editor-actions">
              <button className="button button-primary" type="button" disabled={disabled || !dirty} onClick={onSave}>
                Salvar
              </button>
              <button className="button" type="button" disabled={disabled} onClick={onAppend}>Acrescentar</button>
              <button className="button" type="button" disabled={disabled} onClick={onReplace}>Substituir trecho</button>
            </div>
            {dirty && <p className="editor-status" role="status">Alterações não salvas.</p>}
          </>
        )}
      </div>
    </section>
  );
}
