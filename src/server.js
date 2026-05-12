const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

const config = require('./config');
const JsonStore = require('./store');
const DockerService = require('./dockerService');
const BackupService = require('./backupService');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function computeNextRunAt(scheduledAt, frequency) {
  const base = new Date(scheduledAt);
  if (frequency === 'once') return base;

  const now = new Date();
  let next = new Date(base);
  while (next <= now) {
    if (frequency === 'daily') next.setDate(next.getDate() + 1);
    else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else break;
  }
  return next;
}

function createDockerServiceForSource(source) {
  if (!source) return null;
  if (source.type === 'unix-socket') {
    return new DockerService({
      socketPath: source.socketPath || config.dockerSocketPath,
      helperImage: config.helperImage,
    });
  }
  // direct or agent — both connect via TCP
  return new DockerService({
    host: source.host,
    port: source.port || 2375,
    helperImage: config.helperImage,
  });
}

async function main() {
  await fs.mkdir(config.dataDir, { recursive: true });

  const store = new JsonStore(config.storePath);
  await store.init();

  const dockerService = new DockerService({
    socketPath: config.dockerSocketPath,
    helperImage: config.helperImage,
  });

  const backupService = new BackupService({ dockerService, store });
  const runJobs = new Map();

  const app = express();

  app.use(express.json());

  // ─── Auth middleware ──────────────────────────────────────
  async function authMiddleware(request, response, next) {
    const settings = await store.getSettings();
    if (!settings.requireAuth) {
      return next();
    }

    const token = request.headers['x-auth-token'];
    if (!token) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const expected = hashPassword(`${settings.username}:${settings.passwordHash}:${settings.username}`);
    if (token !== expected) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  }

  // Static files served without auth (login page needs to load)
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  // Login endpoint (public)
  app.post('/api/login', async (request, response) => {
    try {
      const settings = await store.getSettings();
      if (!settings.requireAuth) {
        return response.json({ token: null, requireAuth: false });
      }

      const { username, password } = request.body || {};
      if (!username || !password) {
        return response.status(400).json({ error: 'Informe usuario e senha.' });
      }

      if (username !== settings.username || hashPassword(password) !== settings.passwordHash) {
        return response.status(401).json({ error: 'Usuario ou senha incorretos.' });
      }

      const token = hashPassword(`${settings.username}:${settings.passwordHash}:${settings.username}`);
      return response.json({ token, requireAuth: true });
    } catch (error) {
      return response.status(500).json({ error: error.message });
    }
  });

  // Auth check endpoint (public)
  app.get('/api/auth-status', async (_request, response) => {
    try {
      const settings = await store.getSettings();
      response.json({ requireAuth: settings.requireAuth });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // Settings endpoints (auth-protected)
  app.get('/api/settings', authMiddleware, async (_request, response) => {
    try {
      const settings = await store.getSettings();
      response.json({ language: settings.language, requireAuth: settings.requireAuth, username: settings.username });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/settings', authMiddleware, async (request, response) => {
    try {
      const payload = request.body || {};
      const current = await store.getSettings();

      const update = {
        language: payload.language || current.language,
        requireAuth: typeof payload.requireAuth === 'boolean' ? payload.requireAuth : current.requireAuth,
        username: payload.username !== undefined ? String(payload.username).trim() : current.username,
        passwordHash: current.passwordHash,
      };

      if (payload.password) {
        update.passwordHash = hashPassword(payload.password);
      }

      if (update.requireAuth && (!update.username || !update.passwordHash)) {
        return response.status(400).json({ error: 'Defina usuario e senha para ativar autenticacao.' });
      }

      await store.saveSettings(update);
      response.json({ ok: true });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // About endpoint (auth-protected)
  app.get('/api/about', authMiddleware, async (_request, response) => {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkgRaw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgRaw);
      const currentVersion = pkg.version;

      let latestVersion = null;
      try {
        const ghRes = await fetch('https://raw.githubusercontent.com/asabino2/dockerbackup/main/package.json', {
          headers: { 'User-Agent': 'dockerbackup-app' },
          signal: AbortSignal.timeout(8000),
        });
        if (ghRes.ok) {
          const remotePkg = await ghRes.json();
          if (remotePkg.version) latestVersion = String(remotePkg.version);
        }
      } catch {
        // Non-fatal: latestVersion stays null
      }

      response.json({ currentVersion, latestVersion, name: pkg.name || 'dockerbackup' });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // Update endpoint (auth-protected)
  app.post('/api/update', authMiddleware, async (_request, response) => {
    try {
      await execFileAsync('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: process.cwd() });
      try {
        await execFileAsync('npm', ['install', '--omit=dev'], { cwd: process.cwd() });
      } catch {
        // Non-fatal: deps may already be up to date
      }
      response.json({ ok: true });
      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/containers', authMiddleware, async (request, response) => {
    try {
      let ds = dockerService;
      if (request.query.sourceId) {
        const source = await store.getSource(String(request.query.sourceId));
        if (source) ds = createDockerServiceForSource(source);
      }
      const containers = await ds.listContainers();
      response.json(containers);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/containers/:containerId/mounts', authMiddleware, async (request, response) => {
    try {
      let ds = dockerService;
      if (request.query.sourceId) {
        const source = await store.getSource(String(request.query.sourceId));
        if (source) ds = createDockerServiceForSource(source);
      }
      const inspect = await ds.inspectContainer(request.params.containerId);
      const mounts = (inspect.Mounts || [])
        .filter((m) => m.Type === 'bind' || m.Type === 'volume')
        .map((m) => ({
          type: m.Type,
          name: m.Name || null,
          source: m.Source,
          destination: m.Destination,
          rw: m.RW,
        }));
      response.json(mounts);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/profiles', authMiddleware, async (_request, response) => {
    try {
      const profiles = await store.listProfiles();
      response.json(profiles);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/profiles', authMiddleware, async (request, response) => {
    try {
      const payload = request.body || {};
      if (!payload.name || !Array.isArray(payload.containerIds) || !payload.containerIds.length) {
        response.status(400).json({ error: 'Informe nome, local de armazenamento e ao menos um container.' });
        return;
      }

      let resolvedBackupDir = payload.backupDir;
      if (payload.storageLocationId) {
        const locations = await store.listStorageLocations();
        const loc = locations.find((l) => l.id === payload.storageLocationId);
        if (!loc) {
          response.status(400).json({ error: 'Local de armazenamento nao encontrado.' });
          return;
        }
        resolvedBackupDir = loc.directory;
        if (!resolvedBackupDir && loc.type && loc.type !== 'local') {
          response.status(400).json({ error: 'O tipo de armazenamento selecionado (remoto) ainda não suporta execução de backup. Utilize um local do tipo "Local".' });
          return;
        }
      }

      if (!resolvedBackupDir) {
        response.status(400).json({ error: 'Informe o local de armazenamento.' });
        return;
      }

      if (payload.backupScope && !['volumes', 'container'].includes(payload.backupScope)) {
        response.status(400).json({ error: 'Tipo de backup invalido.' });
        return;
      }

      const existing = payload.id ? await store.getProfile(payload.id) : null;
      const profile = await store.saveProfile({
        id: payload.id,
        createdAt: existing?.createdAt,
        name: payload.name.trim(),
        backupDir: resolvedBackupDir.trim(),
        storageLocationId: payload.storageLocationId || existing?.storageLocationId || null,
        sourceId: payload.sourceId || existing?.sourceId || null,
        containerIds: payload.containerIds,
        mode: existing?.mode || 'full',
        backupScope: payload.backupScope || existing?.backupScope || 'volumes',
        volumeSelections: payload.volumeSelections || existing?.volumeSelections || {},
      });

      response.status(payload.id ? 200 : 201).json(profile);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/profiles/:profileId', authMiddleware, async (request, response) => {
    try {
      const profileId = request.params.profileId;
      const profile = await store.getProfile(profileId);
      const backups = await store.listBackups(profileId);

      await store.deleteProfile(profileId);

      // Deleta arquivos de backup gravados em disco usando os caminhos registrados
      const slugifyLocal = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
      const deletedProfileDirs = new Set();
      for (const backup of backups) {
        const backupRoot = backup.backupDir;
        if (!backupRoot) continue;
        for (const container of backup.containers || []) {
          if (container.archiveRelativePath) {
            await fs.rm(path.join(backupRoot, container.archiveRelativePath), { force: true });
          }
        }
        if (profile?.name) {
          deletedProfileDirs.add(path.join(backupRoot, slugifyLocal(profile.name)));
        }
      }

      // Limpa a pasta do profile (cobre .snar e outros arquivos não registrados no store)
      if (profile?.backupDir) {
        deletedProfileDirs.add(path.join(profile.backupDir, slugifyLocal(profile.name)));
      }
      for (const dir of deletedProfileDirs) {
        await fs.rm(dir, { recursive: true, force: true });
      }

      response.status(204).end();
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/profiles/:profileId/backups', authMiddleware, async (request, response) => {
    try {
      const backups = await store.listBackups(request.params.profileId);
      response.json(backups);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/backups/:backupId', authMiddleware, async (request, response) => {
    try {
      const backup = await store.getBackup(request.params.backupId);
      if (!backup) {
        response.status(404).json({ error: 'Backup nao encontrado.' });
        return;
      }
      response.json(backup);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/profiles/:profileId/run', authMiddleware, async (request, response) => {
    try {
      const profileId = request.params.profileId;
      const requestedMode = request.body?.mode;
      const basedOnFullBackupId = request.body?.basedOnFullBackupId || null;
      if (requestedMode && !['full', 'incremental'].includes(requestedMode)) {
        response.status(400).json({ error: 'Modo de backup invalido.' });
        return;
      }

      const runningJob = [...runJobs.values()].find((job) => job.profileId === profileId && job.status === 'running');
      if (runningJob) {
        response.status(409).json({ error: 'Ja existe um backup em execucao para este profile.', runId: runningJob.id });
        return;
      }

      const runId = crypto.randomUUID();
      const job = {
        id: runId,
        profileId,
        kind: 'backup',
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: null,
        result: null,
        error: null,
      };

      runJobs.set(runId, job);

      let runBackupService = backupService;
      try {
        const runProfile = await store.getProfile(profileId);
        if (runProfile?.sourceId) {
          const source = await store.getSource(runProfile.sourceId);
          if (source) {
            runBackupService = new BackupService({ dockerService: createDockerServiceForSource(source), store });
          }
        }
      } catch {
        // Fall back to default backupService
      }

      void runBackupService.runProfile(profileId, {
        mode: requestedMode,
        basedOnFullBackupId,
        onProgress: (progressSnapshot) => {
          const currentJob = runJobs.get(runId);
          if (!currentJob) {
            return;
          }

          currentJob.progress = progressSnapshot;
        },
      }).then((backupRun) => {
        const currentJob = runJobs.get(runId);
        if (!currentJob) {
          return;
        }

        currentJob.status = backupRun.status === 'ok' ? 'completed' : 'completed-with-errors';
        currentJob.result = backupRun;
        currentJob.finishedAt = new Date().toISOString();
      }).catch((error) => {
        const currentJob = runJobs.get(runId);
        if (!currentJob) {
          return;
        }

        currentJob.status = 'error';
        currentJob.error = error.message;
        currentJob.finishedAt = new Date().toISOString();
      });

      response.status(202).json({ runId, status: 'running' });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/runs/:runId', authMiddleware, (request, response) => {
    const job = runJobs.get(request.params.runId);
    if (!job) {
      response.status(404).json({ error: 'Execucao nao encontrada.' });
      return;
    }

    response.json({
      id: job.id,
      profileId: job.profileId,
      kind: job.kind || 'backup',
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.progress,
      result: job.result,
      error: job.error,
    });
  });

  app.post('/api/profiles/:profileId/restore', authMiddleware, async (request, response) => {
    try {
      const profileId = request.params.profileId;
      if (!request.body?.backupId) {
        response.status(400).json({ error: 'Informe o backup a ser restaurado.' });
        return;
      }

      const selectedContainerIds = request.body?.containerIds;
      if (selectedContainerIds && (!Array.isArray(selectedContainerIds) || !selectedContainerIds.length)) {
        response.status(400).json({ error: 'Selecione ao menos um container para restaurar.' });
        return;
      }

      const runningJob = [...runJobs.values()].find((job) => job.profileId === profileId && job.status === 'running');
      if (runningJob) {
        response.status(409).json({ error: 'Ja existe uma execucao em andamento para este profile.', runId: runningJob.id });
        return;
      }

      const runId = crypto.randomUUID();
      const job = {
        id: runId,
        profileId,
        kind: 'restore',
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: null,
        result: null,
        error: null,
      };

      runJobs.set(runId, job);

      let restoreBackupService = backupService;
      try {
        const restoreProfile = await store.getProfile(profileId);
        if (restoreProfile?.sourceId) {
          const source = await store.getSource(restoreProfile.sourceId);
          if (source) {
            restoreBackupService = new BackupService({ dockerService: createDockerServiceForSource(source), store });
          }
        }
      } catch {
        // Fall back to default backupService
      }

      void restoreBackupService.restoreBackup(profileId, request.body.backupId, {
        selectedContainerIds,
        onProgress: (progressSnapshot) => {
          const currentJob = runJobs.get(runId);
          if (!currentJob) {
            return;
          }

          currentJob.progress = progressSnapshot;
        },
      }).then((restoreResult) => {
        const currentJob = runJobs.get(runId);
        if (!currentJob) {
          return;
        }

        currentJob.status = restoreResult.status === 'ok' ? 'completed' : 'completed-with-errors';
        currentJob.result = restoreResult;
        currentJob.finishedAt = new Date().toISOString();
      }).catch((error) => {
        const currentJob = runJobs.get(runId);
        if (!currentJob) {
          return;
        }

        currentJob.status = 'error';
        currentJob.error = error.message;
        currentJob.finishedAt = new Date().toISOString();
      });

      response.status(202).json({ runId, status: 'running', kind: 'restore' });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/storage-locations', authMiddleware, async (_request, response) => {
    try {
      const locations = await store.listStorageLocations();
      response.json(locations);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/storage-locations', authMiddleware, async (request, response) => {
    try {
      const payload = request.body || {};
      if (!payload.name) {
        response.status(400).json({ error: 'Informe o nome do local de armazenamento.' });
        return;
      }

      const type = payload.type || 'local';
      const validTypes = ['local', 'ftp', 'sftp', 'webdav', 'google-drive'];
      if (!validTypes.includes(type)) {
        response.status(400).json({ error: 'Tipo de armazenamento inválido.' });
        return;
      }

      if (type === 'local' && !payload.directory) {
        response.status(400).json({ error: 'Informe o diretório para armazenamento local.' });
        return;
      }
      if ((type === 'ftp' || type === 'sftp') && (!payload.host || !payload.username)) {
        response.status(400).json({ error: 'Informe host e usuário para FTP/SFTP.' });
        return;
      }
      if (type === 'webdav' && !payload.url) {
        response.status(400).json({ error: 'Informe a URL do servidor WebDAV.' });
        return;
      }
      if (type === 'google-drive' && (!payload.clientId || !payload.clientSecret || !payload.refreshToken)) {
        response.status(400).json({ error: 'Informe Client ID, Client Secret e Refresh Token para Google Drive.' });
        return;
      }

      const existing = payload.id ? await store.listStorageLocations().then((l) => l.find((x) => x.id === payload.id)) : null;

      const location = await store.saveStorageLocation({
        id: payload.id,
        name: payload.name.trim(),
        createdAt: existing?.createdAt,
        type,
        directory: payload.directory?.trim() || null,
        host: payload.host?.trim() || null,
        port: payload.port ? Number(payload.port) : null,
        username: payload.username?.trim() || null,
        password: payload.password || null,
        remotePath: payload.remotePath?.trim() || null,
        passive: payload.passive !== undefined ? Boolean(payload.passive) : null,
        privateKey: payload.privateKey || null,
        url: payload.url?.trim() || null,
        clientId: payload.clientId?.trim() || null,
        clientSecret: payload.clientSecret || null,
        refreshToken: payload.refreshToken || null,
        folderId: payload.folderId?.trim() || null,
      });
      response.status(payload.id ? 200 : 201).json(location);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/storage-locations/:id/impact', authMiddleware, async (request, response) => {
    try {
      const impact = await store.storageLocationImpact(request.params.id);
      response.json({
        profileCount: impact.profiles.length,
        profileNames: impact.profiles.map((p) => p.name),
        backupCount: impact.backupCount,
      });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/storage-locations/:id', authMiddleware, async (request, response) => {
    try {
      const locationId = request.params.id;
      const impact = await store.storageLocationImpact(locationId);

      const slugifyLocal = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';

      // Deleta arquivos em disco de cada profile afetado antes de remover do store
      for (const profile of impact.profiles) {
        const backups = await store.listBackups(profile.id);
        const deletedDirs = new Set();
        for (const backup of backups) {
          const backupRoot = backup.backupDir;
          if (!backupRoot) continue;
          for (const container of backup.containers || []) {
            if (container.archiveRelativePath) {
              await fs.rm(path.join(backupRoot, container.archiveRelativePath), { force: true });
            }
          }
          if (profile.name) {
            deletedDirs.add(path.join(backupRoot, slugifyLocal(profile.name)));
          }
        }
        if (profile.backupDir) {
          deletedDirs.add(path.join(profile.backupDir, slugifyLocal(profile.name)));
        }
        for (const dir of deletedDirs) {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }

      await store.deleteStorageLocation(locationId);
      response.status(204).end();
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/browse-dirs', authMiddleware, async (request, response) => {
    try {
      const rawPath = typeof request.query.path === 'string' ? request.query.path : '/';
      const dirPath = path.resolve('/', rawPath.replace(/\0/g, ''));

      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return response.status(400).json({ error: 'Não foi possível ler o diretório.' });
      }

      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(dirPath, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parent = dirPath !== '/' ? path.dirname(dirPath) : null;
      response.json({ current: dirPath, parent, dirs });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // ─── Source routes ────────────────────────────────────
  app.get('/api/sources/check-unix-socket', authMiddleware, async (_request, response) => {
    try {
      const socketPath = config.dockerSocketPath;
      await fs.access(socketPath);
      const testDs = new DockerService({ socketPath, helperImage: config.helperImage });
      await testDs.docker.ping();
      response.json({ available: true, socketPath });
    } catch {
      response.json({ available: false, socketPath: config.dockerSocketPath });
    }
  });

  app.get('/api/sources', authMiddleware, async (_request, response) => {
    try {
      const sources = await store.listSources();
      response.json(sources);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sources', authMiddleware, async (request, response) => {
    try {
      const payload = request.body || {};
      if (!payload.name) {
        return response.status(400).json({ error: 'Informe o nome da origem.' });
      }
      if (!['unix-socket', 'direct', 'agent'].includes(payload.type)) {
        return response.status(400).json({ error: 'Tipo de origem inválido.' });
      }
      if ((payload.type === 'direct' || payload.type === 'agent') && !payload.host) {
        return response.status(400).json({ error: 'Informe o host para este tipo de origem.' });
      }
      const existing = payload.id ? await store.getSource(payload.id) : null;
      const source = await store.saveSource({
        id: payload.id,
        createdAt: existing?.createdAt,
        name: payload.name.trim(),
        type: payload.type,
        socketPath: payload.socketPath || null,
        host: payload.host?.trim() || null,
        port: payload.port ? Number(payload.port) : null,
      });
      response.status(payload.id ? 200 : 201).json(source);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sources/:id/impact', authMiddleware, async (request, response) => {
    try {
      const impact = await store.sourceImpact(request.params.id);
      response.json({
        profileCount: impact.profiles.length,
        profileNames: impact.profiles.map((p) => p.name),
        backupCount: impact.backupCount,
      });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/sources/:id', authMiddleware, async (request, response) => {
    try {
      const sourceId = request.params.id;
      const impact = await store.sourceImpact(sourceId);

      const slugifyLocal = (value) =>
        value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';

      for (const profile of impact.profiles) {
        const backups = await store.listBackups(profile.id);
        const deletedDirs = new Set();
        for (const backup of backups) {
          const backupRoot = backup.backupDir;
          if (!backupRoot) continue;
          for (const container of backup.containers || []) {
            if (container.archiveRelativePath) {
              await fs.rm(path.join(backupRoot, container.archiveRelativePath), { force: true });
            }
          }
          if (profile.name) {
            deletedDirs.add(path.join(backupRoot, slugifyLocal(profile.name)));
          }
        }
        if (profile.backupDir) {
          deletedDirs.add(path.join(profile.backupDir, slugifyLocal(profile.name)));
        }
        for (const dir of deletedDirs) {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }

      await store.deleteSource(sourceId);
      response.status(204).end();
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // ─── Schedule routes ──────────────────────────────────
  app.get('/api/schedules', authMiddleware, async (_request, response) => {
    try {
      const schedules = await store.listSchedules();
      response.json(schedules);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/schedules', authMiddleware, async (request, response) => {
    try {
      const payload = request.body || {};

      if (!payload.profileId) {
        return response.status(400).json({ error: 'Informe o profile.' });
      }
      if (!payload.scheduledAt) {
        return response.status(400).json({ error: 'Informe a data/hora de início.' });
      }
      if (!['once', 'daily', 'weekly', 'monthly'].includes(payload.frequency)) {
        return response.status(400).json({ error: 'Frequência inválida.' });
      }
      if (payload.backupMode && !['full', 'incremental'].includes(payload.backupMode)) {
        return response.status(400).json({ error: 'Modo de backup inválido.' });
      }

      const profile = await store.getProfile(payload.profileId);
      if (!profile) {
        return response.status(400).json({ error: 'Profile não encontrado.' });
      }

      const scheduledAt = new Date(payload.scheduledAt).toISOString();
      const nextRunAt = computeNextRunAt(scheduledAt, payload.frequency).toISOString();
      const existing = payload.id ? await store.getSchedule(payload.id) : null;

      const schedule = await store.saveSchedule({
        id: payload.id,
        createdAt: existing?.createdAt,
        name: (payload.name || '').trim() || `${profile.name} — ${payload.frequency}`,
        profileId: payload.profileId,
        backupMode: payload.backupMode || 'full',
        basedOnFullBackupId: payload.basedOnFullBackupId || null,
        frequency: payload.frequency,
        scheduledAt,
        nextRunAt,
        enabled: payload.enabled !== false,
        lastRunAt: existing?.lastRunAt || null,
        lastRunStatus: existing?.lastRunStatus || null,
      });

      response.status(payload.id ? 200 : 201).json(schedule);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/schedules/:id/toggle', authMiddleware, async (request, response) => {
    try {
      const schedule = await store.getSchedule(request.params.id);
      if (!schedule) {
        return response.status(404).json({ error: 'Agendamento não encontrado.' });
      }
      const enabled = request.body?.enabled !== undefined ? Boolean(request.body.enabled) : !schedule.enabled;
      const updated = await store.saveSchedule({ ...schedule, enabled });
      response.json(updated);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/schedules/:id', authMiddleware, async (request, response) => {
    try {
      await store.deleteSchedule(request.params.id);
      response.status(204).end();
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // ─── Scheduler ────────────────────────────────────────
  async function runScheduledJobs() {
    let schedules;
    try {
      schedules = await store.listSchedules();
    } catch {
      return;
    }

    const now = new Date();

    for (const schedule of schedules) {
      if (!schedule.enabled || !schedule.nextRunAt) continue;

      const nextRun = new Date(schedule.nextRunAt);
      if (nextRun > now) continue;

      const runningJob = [...runJobs.values()].find(
        (job) => job.profileId === schedule.profileId && job.status === 'running',
      );
      if (runningJob) continue;

      let resolvedFullBackupId = schedule.basedOnFullBackupId;
      if (schedule.backupMode === 'incremental' && !resolvedFullBackupId) {
        try {
          const backups = await store.listBackups(schedule.profileId);
          const fullBackups = backups
            .filter((b) => b.mode === 'full' && (b.status === 'ok' || b.status === 'partial'))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          if (!fullBackups.length) {
            console.log(`[Scheduler] Pulando agendamento incremental "${schedule.name}" (${schedule.id}): nenhum backup full disponível`);
            continue;
          }
          resolvedFullBackupId = fullBackups[0].id;
        } catch {
          continue;
        }
      }

      const newNextRunAt = schedule.frequency === 'once'
        ? null
        : computeNextRunAt(schedule.scheduledAt, schedule.frequency).toISOString();
      const newEnabled = schedule.frequency !== 'once';

      try {
        await store.saveSchedule({
          ...schedule,
          lastRunAt: now.toISOString(),
          nextRunAt: newNextRunAt,
          enabled: newEnabled,
        });
      } catch {
        continue;
      }

      const runId = crypto.randomUUID();
      runJobs.set(runId, {
        id: runId,
        profileId: schedule.profileId,
        kind: 'backup',
        scheduledBy: schedule.id,
        status: 'running',
        startedAt: now.toISOString(),
        progress: null,
        result: null,
        error: null,
      });

      console.log(`[Scheduler] Executando agendamento "${schedule.name}" (${schedule.id})`);

      void backupService.runProfile(schedule.profileId, {
        mode: schedule.backupMode,
        basedOnFullBackupId: resolvedFullBackupId,
      }).then(async (backupRun) => {
        const currentJob = runJobs.get(runId);
        if (currentJob) {
          currentJob.status = backupRun.status === 'ok' ? 'completed' : 'completed-with-errors';
          currentJob.result = backupRun;
          currentJob.finishedAt = new Date().toISOString();
        }
        const latestSchedule = await store.getSchedule(schedule.id);
        if (latestSchedule) {
          await store.saveSchedule({ ...latestSchedule, lastRunStatus: backupRun.status });
        }
      }).catch(async (err) => {
        const currentJob = runJobs.get(runId);
        if (currentJob) {
          currentJob.status = 'error';
          currentJob.error = err.message;
          currentJob.finishedAt = new Date().toISOString();
        }
        const latestSchedule = await store.getSchedule(schedule.id);
        if (latestSchedule) {
          await store.saveSchedule({ ...latestSchedule, lastRunStatus: 'error' });
        }
      });
    }
  }

  setInterval(() => runScheduledJobs().catch(console.error), 60_000);
  setTimeout(() => runScheduledJobs().catch(console.error), 10_000);

  // ─── Backup file browser ──────────────────────────────────
  function resolveArchivePath(profile, containerBackup) {
    if (!profile || !profile.backupDir || !containerBackup || !containerBackup.archiveRelativePath) return null;
    const parts = containerBackup.archiveRelativePath.split('/');
    return path.join(profile.backupDir, ...parts);
  }

  async function listTarFiles(archivePath) {
    const { stdout } = await execFileAsync('tar', ['-tvzf', archivePath], { maxBuffer: 100 * 1024 * 1024 });
    const files = [];
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // GNU tar verbose: permissions owner size date time name
      const parts = trimmed.split(/\s+/);
      if (parts.length < 6) continue;
      const perms = parts[0];
      const size = parseInt(parts[2], 10) || 0;
      const mtime = `${parts[3]} ${parts[4]}`;
      const name = parts.slice(5).join(' ').replace(/^\.\//, '');
      if (!name || name === '.' || name.endsWith('/')) continue;
      files.push({ name, size, isDir: perms.startsWith('d'), mtime });
    }
    return files;
  }

  // GET /api/backups/:backupId/containers/:containerId/files
  app.get('/api/backups/:backupId/containers/:containerId/files', authMiddleware, async (request, response) => {
    try {
      const backup = await store.getBackup(request.params.backupId);
      if (!backup) { response.status(404).json({ error: 'Backup não encontrado.' }); return; }

      const profile = await store.getProfile(backup.profileId);
      if (!profile) { response.status(404).json({ error: 'Profile não encontrado.' }); return; }

      const containerId = request.params.containerId;
      const chain = await store.getBackupsForContainer(backup.profileId, containerId, request.params.backupId);
      if (!chain.length) { response.status(404).json({ error: 'Container não encontrado neste backup.' }); return; }

      // Merge file listings across chain (later archives overwrite earlier ones for same path)
      const fileMap = new Map();
      for (const cb of chain) {
        const archivePath = resolveArchivePath(profile, cb);
        if (!archivePath) continue;
        try {
          const files = await listTarFiles(archivePath);
          for (const file of files) fileMap.set(file.name, file);
        } catch { /* archive not accessible */ }
      }

      const files = [...fileMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      response.json({ files, chainLength: chain.length });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  // POST /api/backups/:backupId/containers/:containerId/extract
  app.post('/api/backups/:backupId/containers/:containerId/extract', authMiddleware, async (request, response) => {
    let tmpDir = null;
    try {
      const selectedPaths = request.body?.paths;
      if (!Array.isArray(selectedPaths) || !selectedPaths.length) {
        response.status(400).json({ error: 'Selecione ao menos um arquivo para extrair.' }); return;
      }
      // Sanitize: strip leading slashes, null bytes, traversal sequences
      const safePaths = selectedPaths
        .map((p) => String(p).replace(/\0/g, '').replace(/^\/+/, '').replace(/\.\.\//g, ''))
        .filter((p) => p.length > 0 && !p.includes('\0'));
      if (!safePaths.length) { response.status(400).json({ error: 'Caminhos inválidos.' }); return; }

      const backup = await store.getBackup(request.params.backupId);
      if (!backup) { response.status(404).json({ error: 'Backup não encontrado.' }); return; }

      const profile = await store.getProfile(backup.profileId);
      if (!profile) { response.status(404).json({ error: 'Profile não encontrado.' }); return; }

      const containerId = request.params.containerId;
      const chain = await store.getBackupsForContainer(backup.profileId, containerId, request.params.backupId);
      if (!chain.length) { response.status(404).json({ error: 'Container não encontrado neste backup.' }); return; }

      // For each selected path, find latest archive in chain containing it
      const archiveExtractMap = new Map(); // archivePath → [paths]
      for (const selectedPath of safePaths) {
        for (let i = chain.length - 1; i >= 0; i--) {
          const archivePath = resolveArchivePath(profile, chain[i]);
          if (!archivePath) continue;
          try {
            const files = await listTarFiles(archivePath);
            const found = files.some((f) => f.name === selectedPath || f.name.startsWith(selectedPath + '/'));
            if (found) {
              if (!archiveExtractMap.has(archivePath)) archiveExtractMap.set(archivePath, []);
              archiveExtractMap.get(archivePath).push(selectedPath);
              break;
            }
          } catch { continue; }
        }
      }

      if (!archiveExtractMap.size) {
        response.status(404).json({ error: 'Arquivos não encontrados nos archives.' }); return;
      }

      tmpDir = path.join(os.tmpdir(), `dbkp-extract-${crypto.randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      for (const [archivePath, pathsToExtract] of archiveExtractMap) {
        await execFileAsync('tar', ['-xzf', archivePath, '-C', tmpDir, '--', ...pathsToExtract], {
          maxBuffer: 500 * 1024 * 1024,
        }).catch(() => null);
      }

      const containerName = (chain[0]?.containerName || containerId.slice(0, 12)).replace(/[^a-zA-Z0-9_-]/g, '-');
      const filename = `extract-${containerName}.tar.gz`;

      response.setHeader('Content-Type', 'application/gzip');
      response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const tarProc = spawn('tar', ['-czf', '-', '-C', tmpDir, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
      tarProc.stdout.pipe(response);

      const cleanup = async () => {
        if (tmpDir) {
          const dirToRemove = tmpDir;
          tmpDir = null;
          await fs.rm(dirToRemove, { recursive: true, force: true }).catch(() => null);
        }
      };
      tarProc.on('close', cleanup);
      tarProc.on('error', cleanup);
      response.on('close', cleanup);
    } catch (error) {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => null);
      if (!response.headersSent) response.status(500).json({ error: error.message });
    }
  });

  app.listen(config.port, () => {
    console.log(`Docker Backup app ouvindo na porta ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});