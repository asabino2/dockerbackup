const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const config = require('./config');
const JsonStore = require('./store');
const DockerService = require('./dockerService');
const BackupService = require('./backupService');

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
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/containers', async (_request, response) => {
    try {
      const containers = await dockerService.listContainers();
      response.json(containers);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/containers/:containerId/mounts', async (request, response) => {
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

  app.get('/api/profiles', async (_request, response) => {
    try {
      const profiles = await store.listProfiles();
      response.json(profiles);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/profiles', async (request, response) => {
    try {
      const payload = request.body || {};
      if (!payload.name || !payload.backupDir || !Array.isArray(payload.containerIds) || !payload.containerIds.length) {
        response.status(400).json({ error: 'Informe nome, diretorio de backup e ao menos um container.' });
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
        backupDir: payload.backupDir.trim(),
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

  app.delete('/api/profiles/:profileId', async (request, response) => {
    try {
      const profile = await store.getProfile(request.params.profileId);
      await store.deleteProfile(request.params.profileId);

      if (profile?.backupDir) {
        const slugify = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
        const profileBackupDir = path.join(profile.backupDir, slugify(profile.name));
        await fs.rm(profileBackupDir, { recursive: true, force: true });
      }

      response.status(204).end();
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/api/profiles/:profileId/backups', async (request, response) => {
    try {
      const backups = await store.listBackups(request.params.profileId);
      response.json(backups);
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/api/profiles/:profileId/run', async (request, response) => {
    try {
      const profileId = request.params.profileId;
      const requestedMode = request.body?.mode;
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

  app.get('/api/runs/:runId', (request, response) => {
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

  app.post('/api/profiles/:profileId/restore', async (request, response) => {
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

  app.listen(config.port, () => {
    console.log(`Docker Backup app ouvindo na porta ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});