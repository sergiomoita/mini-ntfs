# Perguntas técnicas sobre o Mini-NTFS

## 1. O que a MFT simplificada permite descobrir?

`VirtualVolume.entries` reúne as entradas de arquivos e diretórios. A partir de `FileEntry`, o Core identifica o item, seu diretório-pai, seu tamanho em bytes, as datas e a ordem dos blocos de conteúdo. No NTFS, a Master File Table é um arquivo interno com registros e atributos que descrevem os arquivos e a localização dos dados. O Mini-NTFS representa essa ideia com objetos em uma lista JSON. [Tipos do projeto](../packages/filesystem/src/types.ts) · [MFT no NTFS, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/fileio/master-file-table)

## 2. Por que o ID do arquivo é separado dos IDs dos blocos?

`id` é a identidade do item, atribuída por `nextId` na criação. `blockIds` contém posições de armazenamento que podem mudar após uma sobrescrita. O mesmo arquivo continua acessível pelo mesmo ID depois de renomear, mover ou regravar seu conteúdo. [Core](../packages/filesystem/src/filesystem.ts)

## 3. Como os diretórios formam uma hierarquia?

Um filho guarda o ID do pai em `parentId`. A raiz tem ID `1` e `parentId` nulo. O Core pode listar os filhos diretos com `listEntries(parentId)`, e o React deriva a lista do explorador do estado recebido da API. Para montar o caminho, a interface segue os pais até chegar à raiz. [Core](../packages/filesystem/src/filesystem.ts) · [React](../apps/web/src/App.tsx)

## 4. Dois arquivos podem ter o mesmo nome?

Podem ficar em pastas diferentes. Entre entradas com o mesmo `parentId`, `validateName()` compara os nomes em minúsculas depois de aparar espaços do nome recebido. Assim, `Notas.txt` e `notas.txt` entram em conflito na mesma pasta, inclusive se uma entrada for um diretório. Uma renomeação exclui da comparação a própria entrada renomeada. [Validação de nomes](../packages/filesystem/src/filesystem.ts)

## 5. O que o bitmap informa?

O bitmap é um vetor de booleanos. `bitmap[i]` informa se `blocks[i]` está ocupado. Para saber a qual arquivo um bloco pertence, consulte a entrada cujo `blockIds` contém o índice. No NTFS documentado pela Microsoft, o arquivo interno `$Bitmap` marca os clusters ocupados do volume, e a MFT tem um atributo próprio para registrar quais de seus registros estão em uso. [Modelo do projeto](../packages/filesystem/src/types.ts) · [Formato da MFT e bitmap no NTFS, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/devnotes/master-file-table)

## 6. O que são clusters e como eles se relacionam com os blocos do projeto?

Um cluster é uma unidade de alocação formada por setores. Os 64 blocos lógicos de 256 bytes do Mini-NTFS cumprem o papel didático de unidades de alocação. Seus índices identificam posições dentro do JSON, e o sistema de arquivos hospedeiro administra a localização física desse JSON. [Tipos e constantes do Core](../packages/filesystem/src/types.ts) · [Arquivos e clusters, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/fileio/files-and-clusters)

## 7. O limite de 16 KiB é o tamanho do arquivo JSON?

Os 16 KiB vêm de `64 × 256` e representam a capacidade lógica dos blocos de conteúdo. O JSON também armazena metadados, o mapa de ocupação, a representação em Base64 e a formatação. Um texto de 300 bytes ocupa dois blocos e reserva 512 bytes. A MFT informa 300 em `sizeBytes`, enquanto o painel de capacidade contabiliza 512 bytes reservados. [Estruturas de volume](../packages/filesystem/src/types.ts) · [Cálculo da API](../apps/api/src/routes.ts)

## 8. Como o first-fit encontra espaço?

`overwriteFile()` divide o tamanho UTF-8 pelo tamanho do bloco e arredonda para cima. Depois, em uma cópia do volume, percorre o bitmap a partir do índice zero e aproveita o primeiro bloco livre que encontra para cada trecho. Quando completa a quantidade necessária, para de buscar. Se os índices `0` e `2` estiverem ocupados, um arquivo que precisa de dois blocos pode usar `1` e `3`. [Alocação no Core](../packages/filesystem/src/filesystem.ts)

## 9. Um arquivo fragmentado continua legível?

Sim. Um arquivo de 600 bytes pode usar, por exemplo, os blocos `[1, 3, 4]`. Os dois primeiros guardam 256 bytes cada e o terceiro guarda 88 bytes. A lista na MFT preserva a sequência dos trechos, então a leitura funciona com índices não contíguos. No NTFS, a Microsoft descreve um *extent* como uma sequência contígua de clusters, e um arquivo pode ocupar mais de um *extent*. [Leitura no Core](../packages/filesystem/src/filesystem.ts) · [Clusters e extents, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/fileio/clusters-and-extents)

## 10. Por que o código mede o texto em bytes e decodifica depois de concatenar?

O Core usa `Buffer.from(text, 'utf8')` para obter e medir os bytes. Um caractere acentuado pode ocupar vários bytes, e a fronteira entre dois blocos pode cair no meio dele. `readFile()` decodifica a Base64 de cada bloco para bytes, concatena os buffers em ordem, limita a leitura a `sizeBytes` e converte o conjunto para UTF-8. [Leitura e escrita](../packages/filesystem/src/filesystem.ts)

## 11. Por que armazenar os blocos em Base64?

Base64 representa os bytes de cada bloco como texto para caber em uma string JSON. Um bloco pode conter apenas parte dos bytes de um caractere UTF-8. Usando Base64, cada bloco é recuperado byte a byte para a concatenação ocorrer antes da decodificação em caracteres. A codificação é reversível e aumenta a representação dos bytes. [Modelo e leitura](../packages/filesystem/src/filesystem.ts)

## 12. Qual é a relação entre Salvar, Acrescentar e Substituir?

No editor, **Salvar** chama `overwriteFile()` para gravar a versão completa do texto. `appendFile()` lê o conteúdo atual e concatena o novo trecho no final. `replaceText()` encontra a primeira ocorrência literal com `indexOf()` e monta o texto substituído. Acrescentar e substituir chamam `overwriteFile()` para usar o mesmo algoritmo de gravação. [Core](../packages/filesystem/src/filesystem.ts)

## 13. Por que liberar os blocos antigos antes de sobrescrever?

Isso permite reutilizar a própria alocação do arquivo. Um arquivo de três blocos pode ser sobrescrito por outro texto de três blocos mesmo com o restante do volume cheio. A liberação ocorre na cópia criada por `structuredClone()`. Se faltar espaço, `NO_SPACE` é lançado antes da persistência e o conteúdo anterior continua disponível. [Sobrescrita](../packages/filesystem/src/filesystem.ts)

## 14. O que acontece ao sobrescrever com um texto menor ou vazio?

Na cópia, o Core libera todos os blocos anteriores e só reserva a quantidade exigida pelo novo texto. Se a entrada passar de 600 bytes para 100, ela passa de três para um bloco. Com texto vazio, `sizeBytes` fica zerado e `blockIds` passa a ser vazio, mantendo o registro do arquivo na MFT. [Sobrescrita](../packages/filesystem/src/filesystem.ts)

## 15. Por que mover um arquivo preserva seus dados?

Dentro do volume, a pasta de um item é determinada por `parentId`. Depois de validar o destino e a disponibilidade do nome, `moveEntry()` atualiza `parentId` e `updatedAt` na cópia. `blockIds`, os dados e o próprio ID permanecem iguais. `renameEntry()` segue a mesma ideia ao alterar o nome e a data. [Movimentação e renomeação](../packages/filesystem/src/filesystem.ts)

## 16. Como o Core impede mover uma pasta para dentro de si mesma?

`assertNotMovingIntoDescendant()` começa no diretório de destino e sobe pelos pais. Se o ID da pasta a mover aparecer nesse percurso, mover para aquele destino fecharia um ciclo. O Core retorna `INVALID_MOVE` antes de confirmar qualquer mudança. [Validação de movimentação](../packages/filesystem/src/filesystem.ts)

## 17. O que acontece ao apagar um arquivo ou uma pasta?

`deleteEntry()` verifica se a entrada é a raiz e se um eventual diretório tem filhos. Pastas com filhos geram `DIRECTORY_NOT_EMPTY`. Para um arquivo, a função marca seus blocos como livres no bitmap, coloca `null` em suas posições e remove o registro da MFT. Uma pasta vazia tem somente o registro a remover. [Exclusão](../packages/filesystem/src/filesystem.ts)

## 18. O que acontece se o servidor reiniciar ou encontrar um JSON inválido?

Ao abrir um volume existente, o Core lê o JSON e valida seu formato, a raiz, as relações de parentesco, o bitmap e os dados. Se o arquivo estiver inválido ou ilegível, a abertura retorna erro e preserva o arquivo existente. A criação é usada quando o caminho do volume está ausente. [Carregamento do volume](../packages/filesystem/src/storage.ts)

## 19. A renomeação do temporário tem a mesma função do journaling?

O projeto grava uma cópia completa em um temporário vizinho e, ao final, renomeia para o caminho do volume. Se a gravação falhar antes da troca, o Core mantém o estado anterior em memória e tenta limpar o temporário. A durabilidade em uma queda de energia depende do sistema hospedeiro. O NTFS usa um log de transações e checkpoints para restaurar a consistência do sistema de arquivos após falhas. [Persistência do projeto](../packages/filesystem/src/storage.ts) · [Recuperação do NTFS, Microsoft Learn](https://learn.microsoft.com/en-gb/windows-server/storage/file-server/ntfs-overview#increased-reliability)

## 20. Por que a interface chama o Express em vez de manipular a MFT diretamente?

O React cuida da interação e reapresenta o estado retornado por `GET /api/state`. O Express valida os campos da requisição e traduz erros do Core em respostas HTTP. O Core concentra as regras de alocação, a hierarquia e a persistência. Assim, o mesmo método usado por uma rota pode ser testado diretamente com um volume temporário. [Cliente HTTP](../apps/web/src/api.ts) · [Rotas](../apps/api/src/routes.ts) · [Testes do Core](../packages/filesystem/tests/filesystem.test.ts)

## 21. O bitmap na interface permite ler o conteúdo de um arquivo?

O bitmap informa ocupação e os registros da MFT indicam a ordem dos blocos. `GET /api/state` entrega esses dados com as estatísticas. Quando o usuário abre um arquivo, a interface faz uma requisição separada a `GET /api/files/:id/content`, pela qual o Core reconstrói e devolve o texto. [Rotas do estado e do conteúdo](../apps/api/src/routes.ts)

## 22. Quais escolhas justificam chamar o projeto de simulador didático?

O Mini-NTFS opera localmente, com uma instância por volume, conteúdo de texto e 64 blocos lógicos. Cada alteração bem-sucedida grava o JSON inteiro de forma síncrona. O formato serve para inspecionar as estruturas e os algoritmos durante a apresentação. O NTFS do Windows é um sistema de arquivos montável com recursos como descritores de segurança, cotas e recuperação pelo log de transações. [Descrição do projeto](../README.md) · [Visão geral do NTFS, Microsoft Learn](https://learn.microsoft.com/en-gb/windows-server/storage/file-server/ntfs-overview)
