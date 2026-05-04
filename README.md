# Docker Backup App 

⚠️ **AVISO CRÍTICO:** Esta é uma aplicação em estágio inicial de desenvolvimento, não use em produção de forma alguma, há risco de perda de dados ⚠️ 

Aplicacao web para cadastrar profiles de backup de containers Docker, executar backup full ou incremental e restaurar snapshots de volumes e bind mounts.

## Como funciona

- O app lista os containers via Docker socket.
- Cada backup processa um container por vez: para, executa o backup dos mounts elegiveis e sobe novamente se ele estava rodando.
- O backup usa um container auxiliar com GNU tar e `--listed-incremental` para gerar arquivos compactados `.tar.gz`.
- Quando o app roda dentro de Docker, backup e restore sao feitos via Docker API (`getArchive`/`putArchive`) sem criar helper e sem mapear o root do host.
- Ha dois escopos por profile: `somente volumes` (comportamento tradicional) e `container inteiro` (tar unico por container a partir de `/`).
- O restore aplica a cadeia full + incrementais sobre os mounts atuais do container, limpando o conteudo antes de reconstituir o snapshot escolhido.
- Ao restaurar um backup, e possivel escolher quais containers do backup serao restaurados.

## Requisitos

- Docker Engine com acesso ao socket em `/var/run/docker.sock`.
- O diretorio de backup informado no profile precisa ser visivel para o Docker daemon.
- Em Docker Desktop no Windows, quando o app roda fora de container, paths como `C:\backups` sao convertidos automaticamente para `/run/desktop/mnt/host/c/backups`.
- Quando o app roda dentro de container, use um caminho absoluto interno do container (ex.: `/app/data/backups`).
- O escopo `container inteiro` exige que o app esteja rodando em Docker para usar backup/restore nativos sem helper.

## Executando com Docker Compose

```bash
docker compose up --build
```

Abra `http://localhost:3000`.

O arquivo `docker-compose.example.yml` foi mantido como referencia equivalente ao compose principal.

## Observacoes

- O restore valida se o conjunto de mounts do container continua igual ao do backup selecionado.
- O catalogo de profiles e historico de backups fica salvo em `./data/store.json`.
- Os arquivos `.tar.gz` sao gravados no diretorio de backup configurado em cada profile.