# Roteiro de apresentação do Mini-NTFS

**Duração aproximada de 6 minutos e 20 segundos.** A primeira pessoa apresenta o projeto, a arquitetura e a MFT. A segunda demonstra a alocação, as operações sobre o texto e a persistência.

## Preparação

Instale as dependências conforme o README e abra dois terminais PowerShell na raiz do projeto. No primeiro, configure um volume novo para a apresentação e inicie a API.

```powershell
$env:MINI_NTFS_VOLUME_PATH = "data/ensaio-$([guid]::NewGuid()).json"
npm.cmd run dev -w @mini-ntfs/api
```

No segundo terminal, inicie a interface e abra `http://localhost:5173`.

```powershell
npm.cmd run dev -w @mini-ntfs/web
```

Use o mesmo primeiro terminal para reiniciar a API durante a demonstração. O valor de `MINI_NTFS_VOLUME_PATH` permanece na sessão e aponta para o volume já criado. Para iniciar outro ensaio vazio, pare a API e repita a atribuição com um GUID novo. [Configuração da API](../apps/api/src/server.ts)

## Apresentador 1 · 0:00 a 3:00

### 0:00 a 0:40 · Objetivo

Mostre a interface com a raiz vazia e os 64 blocos livres.

> O Mini-NTFS é um sistema de arquivos virtual para a disciplina de Sistemas Operacionais. Usamos três ideias do NTFS como ponto de partida. A MFT identifica os itens, o bitmap acompanha a ocupação e os blocos guardam o conteúdo. O sistema hospedeiro armazena a simulação em um arquivo JSON.

### 0:40 a 1:25 · Arquitetura

Na interface, aponte o explorador, o editor e a estrutura interna. No código, mostre `api.getState()` no cliente e a rota `GET /state` no Express.

> O React chama a API por HTTP. O Vite encaminha as chamadas locais. O Express valida os campos e chama o Core, que aplica as regras do sistema de arquivos e persiste as mudanças.

[Cliente HTTP](../apps/web/src/api.ts) · [Rotas Express](../apps/api/src/routes.ts)

### 1:25 a 2:10 · MFT e diretórios

Mostre `FileEntry` e `VirtualVolume`. Aponte a linha da raiz na tabela MFT. Ela tem ID `1` e `parentId` nulo, exibido como um traço.

> Cada entrada tem um identificador estável. O `parentId` liga o item à pasta que o contém. Para abrir uma pasta, a interface mostra as entradas cujo `parentId` coincide com o ID dela. `blockIds` indica os blocos de conteúdo e a ordem de leitura.

[Tipos do Core](../packages/filesystem/src/types.ts) · [Explorador](../apps/web/src/App.tsx)

### 2:10 a 3:00 · Criação de pasta e arquivo

Clique em **Nova pasta**, digite `Seminario` e confirme em **Criar pasta**. Abra `Seminario` com duplo clique ou com a seta. Clique em **Novo arquivo**, digite `apresentacao.txt` e confirme. Selecione o arquivo para abrir o editor. Mostre as duas novas linhas na MFT, o tamanho zero e os 64 blocos ainda livres.

> `createDirectory()` e `createFile()` usam `createEntry()`. A função valida o pai e o nome, usa `nextId` e cria a entrada com uma lista vazia de blocos. A criação organiza o volume e deixa o espaço de conteúdo disponível.

[Operações de criação](../packages/filesystem/src/filesystem.ts)

## Apresentador 2 · 3:00 a 6:20

### 3:00 a 3:55 · Escrita, leitura e alocação

Cole no editor o [texto da demonstração](#texto-para-o-editor) e clique em **Salvar**. Aponte os blocos `0`, `1` e `2` ocupados e os mesmos índices na MFT. Volte à raiz, reabra `Seminario` e selecione o arquivo para reler o texto salvo.

> O arquivo é convertido em bytes UTF-8. O first-fit começa no índice zero e seleciona os primeiros blocos livres até completar o espaço exigido. Na leitura, o Core reúne os bytes desses blocos na ordem indicada pela MFT e então decodifica o texto, preservando os acentos.

Mostre a busca no `bitmap` em `overwriteFile()` e o `Buffer.concat()` em `readFile()`. [Algoritmos de escrita e leitura](../packages/filesystem/src/filesystem.ts)

### 3:55 a 4:35 · Acréscimo e substituição

Clique em **Acrescentar**, insira duas quebras de linha seguidas do [parágrafo adicional](#paragrafo-adicional) e confirme. Em **Substituir trecho**, busque `volume`, digite `disco` em **Substituir por** e clique em **Substituir**. Mostre `O disco virtual` na primeira linha e `Quando o volume` na segunda.

> Salvar sobrescreve o texto inteiro. Acrescentar junta o final novo à versão salva. Substituir troca a primeira ocorrência literal do trecho. As duas últimas operações reutilizam `overwriteFile()` para gravar o resultado.

[Operações sobre o texto](../packages/filesystem/src/filesystem.ts)

### 4:35 a 5:15 · Renomear e mover

Com o arquivo selecionado, clique em **Renomear** e confirme `ntfs.txt`. Volte à raiz, crie `Documentos`, reabra `Seminario` e selecione `ntfs.txt`. Clique em **Mover**, selecione `C:\Documentos\` e confirme. Mostre o ID do arquivo e os IDs dos blocos preservados na MFT, com o novo ID de diretório-pai.

> Renomear atualiza o nome. Mover atualiza `parentId`, depois de validar o destino. Nos dois casos, o arquivo mantém sua identidade, os blocos e o conteúdo. Para mover uma pasta, o Core também percorre os ancestrais do destino para impedir ciclos.

[Operações de metadados](../packages/filesystem/src/filesystem.ts)

### 5:15 a 5:55 · Reinício e persistência

No primeiro terminal, pressione **Ctrl+C** e execute novamente `npm.cmd run dev -w @mini-ntfs/api`. Mantenha a mesma variável de ambiente. Após a API voltar, recarregue a página, abra `Documentos` e selecione `ntfs.txt`. Mostre o texto persistido, o identificador e os três blocos ocupados.

> A gravação usa um JSON temporário no mesmo diretório e o renomeia para o caminho do volume. Ao iniciar, a API carrega e valida o JSON existente. Podemos reiniciar a API e observar novamente o mesmo estado.

[Gravação e carregamento](../packages/filesystem/src/storage.ts)

### 5:55 a 6:20 · Exclusão e conclusão

Selecione `ntfs.txt`, clique em **Excluir** e confirme. Mostre os 64 blocos livres. Volte à raiz, selecione e exclua `Seminario` e `Documentos`, agora vazias.

> Ao excluir, o Core remove a entrada da MFT e libera os blocos do arquivo. Conseguimos acompanhar toda a operação pela interface. O Mini-NTFS é um simulador didático de arquivos de texto em um volume lógico de 16 KiB.

[Liberação dos blocos](../packages/filesystem/src/filesystem.ts)

## Texto para o editor

Copie o bloco para o editor. Com separadores de linha LF, ele ocupa 634 bytes UTF-8 sem uma quebra adicional no final. O texto ocupa três blocos de 256 bytes.

```text
O volume virtual registra o conteúdo deste arquivo em blocos lógicos de 256 bytes. Cada trecho faz parte de uma sequência preservada na tabela de metadados.
Quando o volume recebe um novo texto, o algoritmo procura os primeiros blocos livres e marca as posições no bitmap de ocupação.
A leitura reconstrói o conteúdo pela ordem dos blocos registrada para o arquivo. Caracteres como ação, memória e organização têm bytes que precisam chegar juntos na decodificação.
O explorador mostra a hierarquia de diretórios, enquanto o painel de armazenamento permite observar os efeitos de escrever, mover e excluir um arquivo.
```

## Parágrafo adicional

Insira duas quebras de linha no campo **Texto a acrescentar** e cole o parágrafo.

```text
A reabertura da API confirma a persistência dos dados.
```

## Checklist de apresentação

- [ ] Usar um volume de ensaio novo e manter o caminho configurado no terminal da API.
- [ ] Abrir a interface, os tipos, o Core e `storage.ts` antes de começar.
- [ ] Confirmar a velocidade da demonstração com o texto pronto para colar.
- [ ] Mostrar a transição de 64 livres para 3 ocupados e a volta aos 64 livres.
- [ ] Verificar conteúdo e metadados após reiniciar, antes de excluir o arquivo.
- [ ] Ensaiar a passagem de fala e responder às perguntas em dupla. [Perguntas e respostas](PERGUNTAS_E_RESPOSTAS.md)
