<p align="center">
  <img src="./public/docker_backup_icon_for_appstore.png" width="200" alt="DockerBackup" />
</p>

<h1 align="center">DockerBackup</h1>

<p align="center">
  <em>Backup e restauração de containers Docker via interface web, com suporte a snapshots incrementais e restore seletivo.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VERSION-1.0.0-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/NODE.JS-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/DOCKER-ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/READY-yes-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/STATUS-ACTIVE-success?style=flat-square" />
</p>

> ⚠️ **AVISO CRÍTICO:** Aplicação em estágio inicial de desenvolvimento. Não use em produção — há risco de perda de dados.

Versão atual: **1.0.0**

---

## 🗄️ Visão geral

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
