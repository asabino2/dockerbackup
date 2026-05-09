<p align="center">
  <img src="./public/docker_backup_icon_for_appstore.png" width="200" alt="DockerBackup" />
</p>

<h1 align="center">DockerBackup</h1>

<p align="center">
  <em>Backup e restauração de containers Docker via interface web, com suporte a snapshots incrementais e restore seletivo.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VERSION-0.0.7-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/NODE.JS-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/DOCKER-ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/READY-yes-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/STATUS-ACTIVE-success?style=flat-square" />
</p>

> ⚠️ **AVISO CRÍTICO:** Aplicação em estágio inicial de desenvolvimento. Não use em produção — há risco de perda de dados.

Versão atual: **0.0.7**

---

## � Changelog

### [0.0.7] — 2026-05-09

#### Adicionado
- **Exclusão em cascata de Storage Location:** ao excluir um local de armazenamento, o sistema busca automaticamente todos os profiles vinculados e seus respectivos backups e os exclui junto. Antes de confirmar, o usuário recebe um aviso detalhado listando os nomes dos profiles afetados e a quantidade de backups que serão removidos.
- **Rota `GET /api/storage-locations/:id/impact`:** nova rota que retorna, sem fazer alterações, quantos profiles e backups serão impactados pela exclusão de um local de armazenamento.

---

### [0.0.6] — 2026-05-09

#### Adicionado
- **Seletor de temas:** nova seção na aba Configurações com 11 temas visuais (Padrão, Escuro, Amanhecer, Floresta, Oceano, Púrpura, Rosa, Laranja, Grafite, Safira, Alto Contraste). O tema selecionado é aplicado imediatamente e salvo no navegador.
- **Changelog dinâmico:** a aba Sobre agora busca e exibe o changelog diretamente do `README.md` do GitHub, sem necessidade de atualização manual na interface.

#### Corrigido
- **Botões Run/Editar/Excluir:** estilizados usando o sistema de design existente (`.btn`). Run ficou azul/primário, Editar em cinza/secundário e Excluir em vermelho com borda.
- **`docker-compose.yml`:** `restart: unless-stopped` descomentado para garantir que o container reinicie automaticamente após uma atualização via botão da aba Sobre.

---

### [0.0.5] — 2026-05-09

#### Adicionado
- **Navegador de diretórios:** no modal de criação/edição de Storage Location, o campo Diretório ganhou um botão de pesquisa (ícone de pasta). Ao clicar, abre um popup que lista os diretórios do servidor, permitindo navegar hierarquicamente e selecionar o caminho desejado sem precisar digitá-lo manualmente.
- **Rota `GET /api/browse-dirs`:** nova rota protegida que aceita o parâmetro `path` e retorna os subdiretórios não-ocultos do caminho informado, junto ao caminho pai e ao caminho atual.

---

### [0.0.4] — Correções de bugs

#### Corrigido
- **Progresso do backup:** contador de arquivos processados ultrapassava o total porque `find -type f` contava apenas arquivos regulares, enquanto o `tar -v` emite uma linha por entrada (incluindo diretórios e symlinks). Corrigido removendo `-type f` do comando `find`.
- **Aba Sobre — última versão:** a verificação da versão mais recente era feita no browser, falhando dentro do Docker por restrições de rede/CORS. A requisição foi movida para o backend, que lê o `package.json` diretamente do repositório via `raw.githubusercontent.com`.

---
### [0.0.3] — Settings, About, i18n e autenticação

#### Adicionado
- **Configurações:** nova aba com seletor de idioma (10 idiomas) e controle de acesso por usuário/senha
- **Sobre:** nova aba com logo, descrição, versão atual, verificação de última versão via GitHub e botão de atualização automática
- **i18n:** suporte a 10 idiomas — Português (pt-BR), English, Español, Deutsch, Polski, Italiano, Русский, 中文, 日本語, فارسی
- **Autenticação opcional:** todas as rotas da API protegidas por token SHA-256 quando habilitado; endpoints `/api/login` e `/api/auth-status` são públicos
- **Atualização automática:** endpoint `POST /api/update` executa `git pull` e reinicia o container

---
### [0.0.2] — 2026-05-09

#### Adicionado
- **Storage Locations:** nova seção para cadastrar locais de armazenamento (nome + diretório). Agora o diretório de backup é selecionado via dropdown ao criar/editar um profile, em vez de ser digitado manualmente.
- **Backup Incremental — seleção de base:** ao executar um backup incremental com múltiplos backups full disponíveis, um modal é exibido para o usuário escolher qual será usado como base. Com apenas um full disponível, é selecionado automaticamente.
- **Bloqueio de incremental sem full:** o botão de backup incremental é bloqueado com mensagem de aviso caso não exista nenhum backup full realizado para o profile.
- **Agrupamento na aba Backups:** backups incrementais são exibidos agrupados e indentados abaixo do seu respectivo backup full, com badges visuais distintos (verde para Full, amarelo para Incremental).

#### Removido
- Abas **Servers** e **Naming Rules** removidas da interface.

---

### [0.0.1] — inicial

- Cadastro de profiles de backup por container
- Backup full e incremental com GNU tar + `--listed-incremental`
- Restore seletivo de snapshots
- Suporte a escopos `somente volumes` e `container inteiro`
- Suporte a Docker API nativa (`getArchive`/`putArchive`) quando rodando dentro de container

---

## �🗄️ Visão geral

O `dockerbackup` fornece:

- Cadastro de **profiles de backup** por container
- Backup **full e incremental** com GNU tar + `--listed-incremental`
- Restore seletivo de snapshots, escolhendo quais containers restaurar
- Suporte a dois escopos: `somente volumes` e `container inteiro`
- Quando rodando dentro do Docker, usa a API nativa (`getArchive`/`putArchive`) sem helper

---

## ⚙️ Instalação

```bash
npm install
```

### Requisitos

- Docker Engine com acesso ao socket em `/var/run/docker.sock`
- O diretório de backup configurado no profile precisa ser visível para o Docker daemon
- Em Docker Desktop no Windows (fora de container), paths como `C:\backups` são convertidos automaticamente para `/run/desktop/mnt/host/c/backups`
- O escopo `container inteiro` exige que o app esteja rodando em Docker

---

## ▶️ Execução

### Com Docker Compose (recomendado)

```bash
docker compose up --build
```

Acesse `http://localhost:3000`.

### Sem Docker

```bash
npm start
```

---

## 📋 Observações

- O restore valida se o conjunto de mounts do container continua igual ao do backup selecionado
- O catálogo de profiles e histórico de backups fica em `./data/store.json`
- Os arquivos `.tar.gz` são gravados no diretório configurado em cada profile
- O arquivo `docker-compose.example.yml` foi mantido como referência equivalente ao compose principal
