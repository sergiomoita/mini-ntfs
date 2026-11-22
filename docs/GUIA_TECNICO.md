# Guia técnico do Mini-NTFS

## Arquitetura e responsabilidades

| Parte | Responsabilidade | Código |
| --- | --- | --- |
| React | Exibe os filhos da pasta atual, mantém o rascunho do editor e apresenta a MFT, o bitmap e as mensagens da API. | [App.tsx](../apps/web/src/App.tsx) · [StoragePanel.tsx](../apps/web/src/components/StoragePanel.tsx) |
| Express | Recebe JSON, valida o formato dos parâmetros e encaminha cada pedido à instância de `MiniFileSystem`. As rotas convertem erros do Core em respostas HTTP. | [server.ts](../apps/api/src/server.ts) · [routes.ts](../apps/api/src/routes.ts) |
| Core | Aplica as regras de nomes e diretórios, modifica a MFT, aloca ou libera blocos e prepara o estado que será persistido. | [filesystem.ts](../packages/filesystem/src/filesystem.ts) |
| Volume JSON | Guarda uma fotografia completa do volume virtual. O módulo de armazenamento lê e valida essa fotografia na abertura e a substitui quando uma alteração é confirmada. | [storage.ts](../packages/filesystem/src/storage.ts) |

### Do botão Salvar ao disco

1. `FileEditor` chama `onSave`. Em `App.tsx`, `saveFile()` passa o ID do arquivo e o texto do editor para `api.overwriteFile()`. Esse método usa `fetch` para enviar `PUT /api/files/:id/content` com um objeto JSON que contém `text`. [FileEditor.tsx](../apps/web/src/components/FileEditor.tsx) · [App.tsx](../apps/web/src/App.tsx#L160) · [api.ts](../apps/web/src/api.ts#L37)
2. O Vite encaminha `/api` à porta 3001. A rota Express lê o ID e o campo `text`, chama `filesystem.overwriteFile(id, text)` e devolve o registro atualizado no campo `data` da resposta. [vite.config.ts](../apps/web/vite.config.ts) · [routes.ts](../apps/api/src/routes.ts)
3. O Core faz a alocação em uma cópia do volume. `commitChange()` chama `saveVolume()` e adota a cópia em memória depois que a gravação termina. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L62) · [storage.ts](../packages/filesystem/src/storage.ts#L47)
4. Ao receber sucesso, `updateVolume()` chama `GET /api/state`. A resposta atualiza a tabela da MFT, o bitmap e os indicadores de espaço. Para uma alteração de conteúdo, o React também relê o texto pelo endpoint do arquivo. [App.tsx](../apps/web/src/App.tsx#L115) · [StoragePanel.tsx](../apps/web/src/components/StoragePanel.tsx)

A resposta do Express tem `ok: true` e `data` no sucesso ou `ok: false` e `error` na falha. Por exemplo, `NO_SPACE` vira HTTP 507, `DUPLICATE_NAME` vira 409 e `NOT_FOUND` vira 404. O cliente apresenta a mensagem recebida ao usuário. [routes.ts](../apps/api/src/routes.ts#L94) · [api.ts](../apps/web/src/api.ts)

## Estruturas de dados

### `VirtualVolume`

| Campo | Uso |
| --- | --- |
| `version` e `label` | Identificam a versão `1` do formato e o rótulo do volume. |
| `blockSize` e `blockCount` | Definem 64 blocos de 256 bytes, totalizando 16.384 bytes ou 16 KiB de capacidade lógica. |
| `nextId` | Guarda o próximo ID a atribuir. Começa em `2` porque a raiz usa o ID `1`. |
| `entries` | Guarda os registros da MFT simplificada em um vetor de `FileEntry`. |
| `bitmap` | Indica a ocupação por índice. `false` representa um bloco livre e `true` representa um bloco ocupado. |
| `blocks` | Guarda os bytes dos blocos em Base64. O valor `null` representa um bloco livre. |

O índice liga `bitmap[i]` a `blocks[i]`. Uma posição ocupada tem conteúdo em Base64 e pertence a exatamente um arquivo. O estado inicial tem 64 posições livres. [types.ts](../packages/filesystem/src/types.ts#L23) · [storage.ts](../packages/filesystem/src/storage.ts)

### `FileEntry` e MFT simplificada

Cada registro guarda o `id`, o `parentId`, o `name` e o `type` da entrada. `sizeBytes` mede o conteúdo em bytes UTF-8 e `blockIds` registra a ordem em que os blocos precisam ser lidos. `createdAt` e `updatedAt` guardam datas em UTC. Diretórios e arquivos vazios têm `sizeBytes` igual a zero e `blockIds` vazio. [types.ts](../packages/filesystem/src/types.ts#L12)

A raiz tem ID `1`, nome `C:` e `parentId: null`. Toda outra entrada aponta para um diretório existente. Se uma pasta tem ID `2`, procurar entradas com `parentId === 2` encontra apenas seus filhos diretos. O explorador monta o caminho atual seguindo os pais no sentido inverso, até chegar à raiz. Nomes de irmãos são comparados sem distinguir maiúsculas e minúsculas. [filesystem.ts](../packages/filesystem/src/filesystem.ts) · [App.tsx](../apps/web/src/App.tsx)

`getState()` devolve uma cópia dos registros e do bitmap, além da capacidade e das contagens de blocos livres e ocupados. A API acrescenta `usedBytes` multiplicando `usedBlocks` por `blockSize`. Os metadados da MFT permitem acompanhar a distribuição dos arquivos. O conteúdo textual é lido separadamente com `readFile()`. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L165) · [routes.ts](../apps/api/src/routes.ts)

### First-fit e leitura de um arquivo fragmentado

Imagine que o bloco `1` já pertence a outro arquivo e os blocos `0` e `2` estão livres. Para escrever o texto abaixo, `overwriteFile()` precisa de `Math.ceil(300 / 256)`, que resulta em dois blocos.

```typescript
const texto = 'a'.repeat(255) + 'á' + 'b'.repeat(43);
// 255 + 2 + 43 = 300 bytes em UTF-8
```

A varredura do bitmap parte de `0`. Ela encontra o primeiro bloco livre em `0`, pula `1` porque está ocupado e usa `2` para completar a alocação. O registro fica com `blockIds` igual a `[0, 2]` e `sizeBytes` igual a `300`. O primeiro bloco guarda 256 bytes e o segundo guarda 44 bytes. São 512 bytes reservados para um conteúdo de 300 bytes. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L62)

Nesse exemplo, os dois bytes de `á` estão separados pela fronteira de um bloco. O Core decodifica cada bloco de Base64 para bytes, concatena os buffers na ordem `[0, 2]` e só então converte a sequência completa para UTF-8. Assim, recupera `á` e todo o texto original. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L41)

## Operações do Core

Os exemplos seguem uma sessão de estudo. `caminhoDoVolumeDeEstudo` representa o caminho escolhido para essa sessão. As variáveis `seminario`, `arquivo` e `documentos` vêm das criações mostradas a seguir.

```typescript
import { MiniFileSystem, ROOT_ENTRY_ID } from '@mini-ntfs/filesystem';

const filesystem = new MiniFileSystem(caminhoDoVolumeDeEstudo);
```

### `createDirectory(parentId: number, name: string): FileEntry`

Cria uma pasta chamada `name` dentro do diretório identificado por `parentId`. `createEntry()` verifica se o pai é um diretório, valida o nome e procura duplicatas entre irmãos. Em uma cópia do volume, cria um registro `directory` com o próximo ID e as datas de criação e atualização. A operação grava `entries` e o novo `nextId`. Pastas são registradas com tamanho zero e lista de blocos vazia. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L33)

```typescript
const seminario = filesystem.createDirectory(ROOT_ENTRY_ID, 'Seminario');
const documentos = filesystem.createDirectory(ROOT_ENTRY_ID, 'Documentos');
```

### `createFile(parentId: number, name: string): FileEntry`

Cria um arquivo vazio na pasta `parentId` com o nome `name`. Usa o mesmo auxiliar `createEntry()` com o tipo `file`. O auxiliar remove espaços nas extremidades do nome, rejeita caracteres de controle e separadores de caminho e exige um nome válido de até 100 caracteres. Depois da confirmação, a MFT tem a nova entrada, `nextId` avança e a cópia persistida já contém o arquivo vazio. A reserva de blocos começa quando há conteúdo para gravar. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L37)

```typescript
const arquivo = filesystem.createFile(seminario.id, 'apresentacao.txt');
```

### `overwriteFile(fileId: number, text: string): FileEntry`

Substitui todo o conteúdo do arquivo `fileId` por `text`. O Core prepara uma cópia do volume, localiza a entrada nela e calcula quantos blocos o texto ocupa a partir de `Buffer.from(text, 'utf8')`. Libera na cópia os blocos da versão anterior para permitir sua reutilização. Em seguida, varre o bitmap desde zero, fatia o buffer em pedaços de até 256 bytes e escreve cada pedaço em Base64 no próximo índice livre.

Se a varredura termina antes de obter a quantidade necessária, lança `NO_SPACE` e abandona a cópia. Quando a alocação é suficiente, a operação grava o novo bitmap, os blocos e os campos `blockIds`, `sizeBytes` e `updatedAt` da entrada. Um texto vazio requer zero blocos, o que libera toda a reserva anterior do arquivo. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L62)

```typescript
filesystem.overwriteFile(arquivo.id, 'O volume tem blocos. Cada bloco guarda bytes.');
```

### `readFile(fileId: number): string`

Lê o texto do arquivo `fileId`. `requireFile()` verifica se o ID existe e se sua entrada é do tipo `file`. A função percorre `blockIds`, decodifica cada valor Base64 com `Buffer.from()` e reúne os pedaços com `Buffer.concat()`. Limita o resultado a `sizeBytes` e converte a sequência para UTF-8. Toda a operação consulta o estado em memória. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L41)

```typescript
const conteudo = filesystem.readFile(arquivo.id);
```

### `appendFile(fileId: number, text: string): FileEntry`

Acrescenta `text` ao final do arquivo `fileId`. Depois de validar que `text` é uma string, chama `readFile(fileId)`, concatena o conteúdo lido com o novo trecho e passa todo o resultado a `overwriteFile()`. O texto informado inclui quaisquer quebras de linha desejadas. A sobrescrita atualiza os campos de conteúdo na MFT, os blocos e o bitmap e persiste o volume. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L55)

```typescript
filesystem.appendFile(arquivo.id, '\n\nA área de dados é dividida em blocos.');
```

### `replaceText(fileId: number, search: string, replacement: string): FileEntry`

Troca a primeira ocorrência literal de `search` por `replacement` no arquivo `fileId`. A função exige um trecho de busca não vazio, lê o arquivo e usa `indexOf()` para encontrar o início da ocorrência. Monta o novo texto juntando o prefixo, a substituição e o sufixo. Uma busca ausente gera `TEXT_NOT_FOUND` antes de qualquer gravação. Em caso de sucesso, `overwriteFile()` atualiza a MFT, o bitmap e os blocos. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L96)

```typescript
filesystem.replaceText(arquivo.id, 'blocos', 'blocos virtuais');
```

### `renameEntry(entryId: number, newName: string): FileEntry`

Renomeia o arquivo ou diretório `entryId` para `newName`. A função verifica se a entrada existe, protege a raiz e valida o novo nome entre os filhos do mesmo pai. O próprio ID é excluído da busca por duplicatas. A alteração registrada na MFT é em `name` e `updatedAt`. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L126)

```typescript
filesystem.renameEntry(arquivo.id, 'ntfs.txt');
```

### `moveEntry(entryId: number, targetParentId: number): FileEntry`

Move a entrada `entryId` para o diretório `targetParentId`. O Core protege a raiz, exige que o destino seja um diretório e verifica se o nome já existe entre os filhos do destino. Para mover uma pasta, percorre os `parentId` a partir do destino. Se encontrar a própria pasta nessa subida, lança `INVALID_MOVE`, pois o novo pai fecharia um ciclo. A operação grava `parentId` e `updatedAt` na MFT. Os filhos continuam vinculados à pasta pelo ID dela, de modo que a subárvore acompanha a mudança. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L139)

```typescript
filesystem.moveEntry(arquivo.id, documentos.id);
```

### `listEntries(parentId: number): readonly EntrySnapshot[]`

Lista os filhos diretos do diretório `parentId`. Verifica se o ID pertence a uma pasta, filtra `entries` por `parentId`, ordena pastas antes de arquivos e depois por nome, e devolve uma cópia dos resultados. A função é uma consulta do Core. Na Web, o explorador aplica o filtro de navegação sobre os registros recebidos de `GET /api/state`. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L158) · [App.tsx](../apps/web/src/App.tsx)

```typescript
const filhos = filesystem.listEntries(documentos.id);
```

### `deleteEntry(entryId: number): void`

Exclui a entrada `entryId`. A raiz é protegida. Se a entrada for uma pasta, o Core verifica se algum registro a referencia como pai e lança `DIRECTORY_NOT_EMPTY` quando há filhos. Na cópia do volume, `releaseBlocks()` marca como livres os índices de `blockIds` e atribui `null` aos blocos correspondentes. A função remove a entrada da MFT e persiste a cópia. O mesmo passo atende uma pasta vazia, cujo vetor de blocos já está vazio. [filesystem.ts](../packages/filesystem/src/filesystem.ts#L111)

```typescript
filesystem.deleteEntry(arquivo.id);
filesystem.deleteEntry(documentos.id);
filesystem.deleteEntry(seminario.id);
```

## Persistência e recuperação do estado

Na abertura, `loadVolume()` cria o estado inicial se o arquivo estiver ausente. Se houver um arquivo, o Core verifica o UTF-8 e o JSON, confere a versão e a geometria, valida IDs e relações entre diretórios e confirma que a MFT, o bitmap e os bytes dos blocos concordam. Uma leitura ou validação que falha interrompe a abertura e preserva o arquivo existente. [storage.ts](../packages/filesystem/src/storage.ts#L21)

Uma alteração válida passa por `saveVolume()`. A função cria um temporário exclusivo no mesmo diretório, escreve a cópia inteira do volume e fecha o arquivo. `replaceVolumeFile()` renomeia o temporário para o caminho final. No Windows, um `EPERM` durante a troca permite até quatro novas tentativas, separadas por 25 ms. Se a gravação ou a troca falhar, `saveVolume()` tenta remover o temporário e o Core mantém o estado anterior em memória. Em uma nova inicialização, os dados vêm do volume persistido, inclusive o próximo ID.

Essa estratégia atende uma instância local por volume. A persistência é síncrona, regrava o JSON inteiro e depende do sistema de arquivos hospedeiro para a durabilidade em caso de queda de energia. Os 16 KiB são a capacidade lógica dos blocos. O tamanho do JSON inclui também a MFT, o bitmap e o custo da codificação Base64. [storage.ts](../packages/filesystem/src/storage.ts#L47) · [filesystem.ts](../packages/filesystem/src/filesystem.ts)
