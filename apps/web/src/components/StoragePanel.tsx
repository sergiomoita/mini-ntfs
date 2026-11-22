import type { VolumeState } from '../types';

type StoragePanelProps = {
  volume: VolumeState | null;
  selectedId: number | null;
};

export function StoragePanel({ volume, selectedId }: StoragePanelProps) {
  return (
    <aside className="panel storage-panel" aria-labelledby="storage-heading">
      <div className="panel-heading">
        <h2 id="storage-heading">Estrutura interna</h2>
      </div>

      {volume ? (
        <div className="panel-body storage-body">
          <section aria-labelledby="mft-heading">
            <h3 id="mft-heading">MFT simplificada</h3>
            <div className="mft-scroll" role="region" aria-labelledby="mft-heading" tabIndex={0}>
              <table className="mft-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Nome</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Diretório-pai</th>
                    <th scope="col">Tamanho (B)</th>
                    <th scope="col">Blocos</th>
                  </tr>
                </thead>
                <tbody>
                  {volume.entries.map((entry) => (
                    <tr key={entry.id} className={entry.id === selectedId ? 'mft-row-selected' : undefined}>
                      <td className="mft-number">{entry.id}</td>
                      <th scope="row">{entry.name}</th>
                      <td>{entry.type === 'directory' ? 'Pasta' : 'Arquivo'}</td>
                      <td className="mft-number">{entry.parentId ?? '—'}</td>
                      <td className="mft-number">{entry.sizeBytes.toLocaleString('pt-BR')}</td>
                      <td className="mft-number">{entry.blockIds.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="bitmap-heading">
            <div className="storage-section-heading">
              <h3 id="bitmap-heading">Bitmap de blocos</h3>
              <span>{volume.blockSize} B por bloco</span>
            </div>
            <ul className="bitmap-grid" aria-labelledby="bitmap-heading">
              {volume.bitmap.map((occupied, index) => (
                <li
                  key={index}
                  className={occupied ? 'bitmap-block is-occupied' : 'bitmap-block'}
                  title={`Bloco ${index} ${occupied ? 'ocupado' : 'livre'}`}
                >
                  <span aria-hidden="true">{index}</span>
                  <span className="sr-only">Bloco {index} {occupied ? 'ocupado' : 'livre'}</span>
                </li>
              ))}
            </ul>
            <ul className="bitmap-legend" aria-label="Ocupação do volume">
              <li><span className="legend-swatch" aria-hidden="true" />{volume.freeBlocks} livres</li>
              <li><span className="legend-swatch is-occupied" aria-hidden="true" />{volume.usedBlocks} ocupados</li>
            </ul>
          </section>
        </div>
      ) : (
        <p className="empty-state">O estado do volume aparece aqui quando a API estiver disponível.</p>
      )}
    </aside>
  );
}
