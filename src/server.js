const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const config = require('./config');
const JsonStore = require('./store');
const DockerService = require('./dockerService');
const BackupService = require('./backupService');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
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

  app.get('/api/containers', authMiddleware, async (_request, response) => {
    try {
      const containers = await dockerService.listContainers();
      response.json(containers);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/containers/:containerId/mounts', authMiddleware, async (request, response) => {
    try {
      const inspect = await dockerService.inspectContainer(request.params.containerId);
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

      void backupService.runProfile(profileId, {
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

      void backupService.restoreBackup(profileId, request.body.backupId, {
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
      if (!payload.name || !payload.directory) {
        response.status(400).json({ error: 'Informe nome e diretorio do local de armazenamento.' });
        return;
      }
      const location = await store.saveStorageLocation({
        id: payload.id,
        name: payload.name.trim(),
        directory: payload.directory.trim(),
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

  app.listen(config.port, () => {
    console.log(`Docker Backup app ouvindo na porta ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});