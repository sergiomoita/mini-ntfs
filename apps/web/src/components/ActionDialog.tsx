import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';

export type DialogAction = 'create-file' | 'create-directory' | 'rename' | 'move' | 'append' | 'replace';

interface ActionDialogProps {
  action: DialogAction;
  entryName?: string;
  destinations: readonly { id: number; label: string }[];
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (fields: FormData) => void;
}

const titles: Record<DialogAction, string> = {
  'create-file': 'Criar arquivo',
  'create-directory': 'Criar pasta',
  rename: 'Renomear',
  move: 'Mover',
  append: 'Acrescentar',
  replace: 'Substituir trecho',
};

export function ActionDialog({ action, entryName, destinations, busy, error, onCancel, onSubmit }: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasNameField = action === 'create-file' || action === 'create-directory' || action === 'rename';
  const noDestination = action === 'move' && destinations.length === 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !noDestination) {
      onSubmit(new FormData(event.currentTarget));
    }
  }

  return (
    <dialog
      className="action-dialog"
      ref={dialogRef}
      aria-labelledby="action-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form className="dialog-form" onSubmit={handleSubmit}>
        <h2 id="action-dialog-title">{titles[action]}</h2>
        {entryName && !hasNameField && <p className="dialog-entry-name">{entryName}</p>}

        <fieldset className="dialog-fields" disabled={busy}>
          {hasNameField && (
            <label>
              Nome
              <input name="name" required defaultValue={action === 'rename' ? entryName : undefined} />
            </label>
          )}
          {action === 'move' && (
            <label>
              Pasta de destino
              <select name="targetParentId" required defaultValue="" disabled={noDestination}>
                <option value="" disabled>Selecione uma pasta</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>{destination.label}</option>
                ))}
              </select>
            </label>
          )}
          {action === 'append' && (
            <label>
              Texto a acrescentar
              <textarea name="text" rows={4} />
            </label>
          )}
          {action === 'replace' && (
            <>
              <label>
                Trecho a buscar
                <textarea name="search" rows={2} required />
              </label>
              <label>
                Substituir por
                <textarea name="replacement" rows={2} />
              </label>
            </>
          )}
        </fieldset>

        {noDestination && <p>Nenhuma pasta de destino disponível.</p>}
        {error && <p className="dialog-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button className="button" type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={busy || noDestination}>
            {action === 'replace' ? 'Substituir' : titles[action]}
          </button>
        </div>
      </form>
    </dialog>
  );
}
