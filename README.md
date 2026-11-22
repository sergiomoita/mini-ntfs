# Mini-NTFS

O Mini-NTFS é um sistema de arquivos virtual e didático para a disciplina de Sistemas Operacionais. Usa ideias do NTFS para mostrar como metadados, diretórios e blocos de dados se relacionam. A aplicação define um formato próprio em JSON e roda em espaço de usuário. O escopo exclui a implementação completa do NTFS e a criação de um driver real.

## Pré-requisitos

- Git para clonar o repositório. [Git para Windows](https://git-scm.com/download/win)
- Node.js 22 a partir de `22.12.0`, ou Node.js 24 ou superior. Use a série 24 para reproduzir o ambiente validado. [Instaladores oficiais do Node.js](https://nodejs.org/en/download)
- npm, incluído no instalador oficial do Node.js. A validação usou Node.js `24.14.1` e npm `11.11.0`.

## Clonar e executar em outro computador

No PowerShell, vá até a pasta onde deseja salvar o projeto. Ao executar `Read-Host`, cole a URL HTTPS do repositório no GitHub. A instalação usa as versões registradas no `package-lock.json` e vincula os três workspaces locais. [Documentação do `npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci)

```powershell
$repoUrl = Read-Host 'Cole a URL HTTPS do repositorio no GitHub'
git clone $repoUrl mini-ntfs
Set-Location -LiteralPath .\mini-ntfs
npm.cmd ci
```

Na raiz do projeto, inicie a API no primeiro terminal.

```powershell
npm.cmd run dev -w @mini-ntfs/api
```

Abra um segundo terminal na mesma pasta e inicie o React.

```powershell
npm.cmd run dev -w @mini-ntfs/web
```

Abra a interface em `http://localhost:5173`. A API Express roda em `http://localhost:3001`, e o Vite encaminha para ela as requisições de `/api`. No Linux ou macOS, use `npm` no lugar de `npm.cmd`.

## Usar a interface

1. Na raiz `C:\`, clique em **Nova pasta**. Abra a pasta pela seta ao lado do nome ou com um duplo clique. Use **Voltar** ou o caminho exibido para subir na hierarquia.
2. Clique em **Novo arquivo**, informe um nome e selecione o arquivo no explorador. Digite no editor e clique em **Salvar** para gravar todo o conteúdo. O editor pede confirmação ao trocar de entrada com alterações pendentes.
3. Use **Acrescentar** para escrever ao final ou **Substituir trecho** para trocar a primeira ocorrência literal de uma busca.
4. Selecione uma entrada e use **Renomear**, **Mover** ou **Excluir**. A movimentação usa um seletor de diretórios. A exclusão pede confirmação e exige que a pasta esteja vazia.
5. Acompanhe a MFT, o bitmap e os indicadores de espaço após cada alteração. O painel da MFT registra o pai de cada entrada e os índices dos blocos de cada arquivo.

## Tecnologias e organização

| Caminho | Responsabilidade |
|---|---|
| `apps/web` (`@mini-ntfs/web`) | Interface React com TypeScript, Vite e CSS. Usa `fetch` para consultar e alterar o volume pela API. |
| `apps/api` (`@mini-ntfs/api`) | Servidor Node.js com Express e `tsx`. Valida as requisições e delega as operações a uma instância de `MiniFileSystem`. |
| `packages/filesystem` (`@mini-ntfs/filesystem`) | Core TypeScript com regras de diretórios, MFT, bitmap, alocação e persistência. Inclui testes Vitest. |
| `data` | Pasta reservada para o volume local `volume.json`. O repositório versiona `.gitkeep` para manter a pasta no clone. |
| `docs` | Guia técnico, roteiro de demonstração e perguntas para a apresentação. |

O npm Workspaces vincula o Core local à API. `GET /api/health` verifica o servidor, `GET /api/state` retorna a MFT, o bitmap e as estatísticas, e `GET /api/files/:id/content` devolve o texto do arquivo em `data.text`.

## MFT, bitmap e alocação

A MFT simplificada é a lista `entries`. Cada registro tem ID, nome, tipo, `parentId`, datas, tamanho em bytes e `blockIds`. A raiz tem ID `1` e `parentId: null`. O explorador lista os filhos diretos ao filtrar pelo ID do diretório atual. Um arquivo vazio e um diretório têm tamanho zero e lista de blocos vazia.

O bitmap tem um booleano por bloco. `false` indica que o bloco está livre. `true` indica que está reservado. O campo `blocks` guarda, na mesma posição, `null` para um bloco livre ou seus bytes codificados em Base64. Os 64 blocos de 256 bytes somam **16.384 bytes (16 KiB)** de capacidade lógica. O espaço reservado conta blocos inteiros. Um arquivo de 300 bytes usa dois blocos e reserva 512 bytes.

Na sobrescrita, o Core libera os blocos antigos numa cópia do volume e percorre o bitmap do início, escolhendo os primeiros índices livres. Esse é o *first-fit*. Os blocos escolhidos podem estar separados. A leitura concatena seus bytes na ordem de `blockIds` antes de decodificar o texto em UTF-8. Assim, um caractere dividido entre dois blocos é reconstruído corretamente. Para acrescentar texto, o Core lê o arquivo, concatena o trecho e reaproveita a sobrescrita integral.

## Persistência e limites

Cada cópia do projeto usa por padrão seu próprio `data/volume.json`, relativo à raiz do repositório. Quando o arquivo está ausente, a API prepara a pasta se necessário e cria um volume com a raiz e os 64 blocos livres. Quando o arquivo existe, o Core o valida e carrega os dados. O `.gitignore` exclui os volumes locais e os temporários de `data/`.

Cada alteração grava a cópia do estado em um arquivo temporário no mesmo diretório e o renomeia para o caminho do volume. No Windows, um `EPERM` nessa troca pode ter até quatro novas tentativas, com 25 ms de intervalo. O Core só substitui o estado em memória depois da gravação. Se faltar espaço ou a gravação falhar, o estado anterior é preservado.

- A capacidade simulada se aplica ao conteúdo de texto UTF-8. O arquivo JSON no disco também guarda metadados e a representação Base64.
- Use uma instância local da API por volume. Cada alteração regrava o JSON inteiro de forma síncrona. A durabilidade em caso de queda de energia depende do sistema de arquivos hospedeiro.
- A demonstração se concentra em metadados e alocação. Permissões de sistema, journaling e recuperação de corrupção estão fora do escopo.

Para ensaiar com um volume separado, defina `MINI_NTFS_VOLUME_PATH` no terminal antes de iniciar a API. O valor pode ser absoluto ou relativo à raiz do projeto. Reutilize o mesmo caminho quando reiniciar a API para continuar com o volume escolhido.

```powershell
$env:MINI_NTFS_VOLUME_PATH = 'data/volume-ensaio.json'
npm.cmd run dev -w @mini-ntfs/api
```

Para voltar ao caminho padrão, inicie a API em uma sessão sem a variável ou execute `Remove-Item Env:MINI_NTFS_VOLUME_PATH` na sessão de ensaio, com a API parada.

## Verificar e apresentar

```powershell
npm.cmd run typecheck
npm.cmd run test -w @mini-ntfs/filesystem
npm.cmd run build -w @mini-ntfs/web
```

A verificação de tipos cobre os três workspaces. O Vitest usa volumes temporários, e o Vite gera o build em `apps/web/dist`.

- [Guia técnico](docs/GUIA_TECNICO.md)
- [Roteiro para dois apresentadores](docs/ROTEIRO_APRESENTACAO.md)
- [Perguntas e respostas para a banca](docs/PERGUNTAS_E_RESPOSTAS.md)

## Resolução de erros

| Sintoma | O que verificar |
|---|---|
| `git`, `node` ou `npm.cmd` indisponível | Após instalar Git e Node.js, abra um novo PowerShell e confira `git --version`, `node --version` e `npm.cmd --version`. |
| O PowerShell bloqueia `npm.ps1` | Use `npm.cmd`, como nos exemplos deste README. |
| `npm ci` falha | Confira a versão do Node.js, o acesso ao registro npm e se o terminal está na raiz do clone, junto a `package.json` e `package-lock.json`. |
| Porta `3001` ou `5173` em uso | Rode `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen` para identificar o processo. Encerre a instância anterior do Mini-NTFS no terminal em que ela foi iniciada antes de tentar de novo. |
| A interface exibe uma falha de conexão | Confira `http://localhost:3001/api/health` diretamente e `http://localhost:5173/api/health` pelo proxy do Vite. Com os dois servidores ativos, ambas as URLs devem responder com `ok: true`. |
| A API acusa volume inválido ou erro de gravação | Confira o caminho e as permissões da pasta do volume. A API preserva o arquivo existente ao detectar um volume inválido. Para isolar o ensaio, indique um caminho novo com `MINI_NTFS_VOLUME_PATH`. |
