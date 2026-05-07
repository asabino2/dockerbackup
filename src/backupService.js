const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `"'"'`)}'`;
}

function slugify(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
}

function formatStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function normalizeDockerHostPath(inputPath) {
  const value = String(inputPath || '').trim();
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    const drive = value[0].toLowerCase();
    const suffix = value.slice(2).replace(/\\/g, '/').replace(/^\/+/, '');
    return `/run/desktop/mnt/host/${drive}/${suffix}`;
  }

  return value.replace(/\\/g, '/');
}

function normalizeContainerPath(inputPath) {
  const value = String(inputPath || '').trim().replace(/\\/g, '/');
  if (!value.startsWith('/')) {
    throw new Error('Em execucao via Docker, o diretorio de backup deve ser absoluto dentro do container (ex.: /app/data/backups).');
  }

  return value;
}

function normalizeMounts(containerInspect) {
  return (containerInspect.Mounts || [])
    .filter((mount) => mount.Type === 'bind' || mount.Type === 'volume')
    .map((mount) => ({
      type: mount.Type,
      name: mount.Name || null,
      source: mount.Source,
      destination: mount.Destination,
      rw: mount.RW,
    }))
    .sort((left, right) => {
      const leftKey = `${left.destination}|${left.type}|${left.name || left.source}`;
      const rightKey = `${right.destination}|${right.type}|${right.name || right.source}`;
      return leftKey.localeCompare(rightKey);
    });
}

function sameMountSignature(leftMounts, rightMounts) {
  if (leftMounts.length !== rightMounts.length) {
    return false;
  }

  return leftMounts.every((left, index) => {
    const right = rightMounts[index];
    return (
      left.type === right.type
      && left.name === right.name
      && left.source === right.source
      && left.destination === right.destination
    );
  });
}

function getMountBindingSource(mount) {
  return mount.type === 'volume' ? mount.name : mount.source;
}

function normalizeBackupScope(value) {
  return value === 'container' ? 'container' : 'volumes';
}

function containerSnapshotPath(profileId, containerId, scope) {
  return `/tmp/dockerbackup-${slugify(profileId)}-${containerId.slice(0, 12)}-${scope}.snar`;
}

function toContainerRelPath(absPath) {
  return String(absPath || '').replace(/^\/+/, '') || '.';
}

function parseManifestLines(rawOutput) {
  const map = new Map();
  for (const line of String(rawOutput || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [relativePath, sizeRaw, mtimeRaw, scopeRaw] = trimmed.split('|');
    if (!relativePath) {
      continue;
    }

    const key = scopeRaw
      ? `${toContainerRelPath(scopeRaw)}/${relativePath}`.replace(/\/\//g, '/')
      : relativePath;

    map.set(key, {
      size: Number(sizeRaw || 0),
      mtime: Number(mtimeRaw || 0),
    });
  }

  return map;
}

function calculateManifestDiff(beforeMap, afterMap) {
  let deleted = 0;
  let created = 0;
  let modified = 0;

  for (const [filePath, beforeEntry] of beforeMap.entries()) {
    const afterEntry = afterMap.get(filePath);
    if (!afterEntry) {
      deleted += 1;
      continue;
    }

    if (beforeEntry.size !== afterEntry.size || beforeEntry.mtime !== afterEntry.mtime) {
      modified += 1;
    }
  }

  for (const filePath of afterMap.keys()) {
    if (!beforeMap.has(filePath)) {
      created += 1;
    }
  }

  return { deleted, created, modified };
}

class BackupService {
  constructor({ dockerService, store }) {
    this.dockerService = dockerService;
    this.store = store;
  }

  async runProfile(profileId, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const profile = await this.store.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile nao encontrado.');
    }

    if (!profile.containerIds.length) {
      throw new Error('Selecione ao menos um container no profile.');
    }

    const effectiveMode = ['full', 'incremental'].includes(options.mode)
      ? options.mode
      : (['full', 'incremental'].includes(profile.mode) ? profile.mode : 'full');

    const backupScope = normalizeBackupScope(profile.backupScope);

    const backupRun = {
      id: randomUUID(),
      profileId: profile.id,
      profileName: profile.name,
      createdAt: new Date().toISOString(),
      mode: effectiveMode,
      backupScope,
      backupDir: profile.backupDir,
      status: 'ok',
      containers: [],
    };

    const progress = {
      profileId: profile.id,
      profileName: profile.name,
      startedAt: backupRun.createdAt,
      status: 'running',
      overall: {
        total: profile.containerIds.length,
        completed: 0,
        pending: profile.containerIds.length,
        percent: 0,
      },
      currentContainer: null,
    };

    const emitProgress = () => {
      onProgress(JSON.parse(JSON.stringify(progress)));
    };

    emitProgress();

    for (const [index, containerId] of profile.containerIds.entries()) {
      progress.currentContainer = {
        containerId,
        index: index + 1,
        total: profile.containerIds.length,
        containerName: null,
        status: 'running',
        step: 'iniciando',
        message: 'Preparando backup do container.',
        logs: [],
        percent: 0,
        file: {
          current: 0,
          total: 0,
          currentFile: null,
          percent: 0,
        },
      };
      emitProgress();

      const containerBackup = await this.backupContainer(profile, containerId, backupRun.createdAt, {
        mode: effectiveMode,
        backupScope,
        onProgress: (containerProgress) => {
          progress.currentContainer = {
            ...progress.currentContainer,
            ...containerProgress,
          };
          emitProgress();
        },
      });

      backupRun.containers.push(containerBackup);
      if (containerBackup.status !== 'ok') {
        backupRun.status = 'partial';
      }

      progress.overall.completed += 1;
      progress.overall.pending = Math.max(0, progress.overall.total - progress.overall.completed);
      progress.overall.percent = progress.overall.total
        ? Math.round((progress.overall.completed / progress.overall.total) * 100)
        : 100;
      progress.currentContainer = {
        ...(progress.currentContainer || {}),
        status: containerBackup.status,
        percent: 100,
      };
      emitProgress();
    }

    await this.store.addBackup(backupRun);

    progress.status = backupRun.status === 'ok' ? 'completed' : 'completed-with-errors';
    progress.finishedAt = new Date().toISOString();
    progress.currentContainer = null;
    progress.overall.percent = 100;
    progress.overall.pending = 0;
    emitProgress();

    return backupRun;
  }

  async backupContainer(profile, containerId, runDateIso, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const runMode = ['full', 'incremental'].includes(options.mode)
      ? options.mode
      : (['full', 'incremental'].includes(profile.mode) ? profile.mode : 'full');
    const backupScope = normalizeBackupScope(options.backupScope || profile.backupScope);

    let inspect;
    let mounts = [];
    let containerName = containerId.slice(0, 12);

    try {
      inspect = await this.dockerService.inspectContainer(containerId);
      mounts = normalizeMounts(inspect);
      containerName = inspect.Name.replace(/^\//, '');
    } catch (error) {
      onProgress({ containerName, status: 'error', percent: 100, step: 'erro', message: error.message });
      return {
        containerId,
        containerName,
        status: 'error',
        mode: runMode,
        error: `Falha ao inspecionar container: ${error.message}`,
      };
    }

    if (backupScope === 'volumes' && !mounts.length) {
      onProgress({
        containerName,
        status: 'skipped',
        step: 'concluido',
        message: 'Container sem volumes elegiveis.',
        percent: 100,
        file: { current: 0, total: 0, currentFile: null, percent: 100 },
      });
      return {
        containerId: inspect.Id,
        containerName,
        status: 'skipped',
        mode: runMode,
        message: 'Container sem volumes ou bind mounts elegiveis.',
      };
    }

    const runInDocker = this.dockerService.isRunningInDocker();
    const backupRoot = runInDocker
      ? normalizeContainerPath(profile.backupDir)
      : normalizeDockerHostPath(profile.backupDir);
    const safeContainerName = slugify(containerName);
    const safeProfileName = slugify(profile.name);
    const stamp = formatStamp(new Date(runDateIso));
    const archiveRelativePath = path.posix.join(safeProfileName, safeContainerName, `${stamp}-${runMode}.tar.gz`);
    const snapshotRelativePath = path.posix.join(safeProfileName, safeContainerName, 'latest.snar');

    // Filter mounts to only those the user selected (if volumeSelections is defined for this container)
    const selectedPaths = profile.volumeSelections?.[containerId] || profile.volumeSelections?.[inspect.Id];
    const activeMounts = (backupScope === 'volumes' && selectedPaths?.length)
      ? mounts.filter((m) => selectedPaths.includes(m.destination))
      : mounts;

    if (backupScope === 'volumes' && !activeMounts.length) {
      onProgress({
        containerName,
        status: 'skipped',
        step: 'concluido',
        message: 'Nenhum volume selecionado para backup.',
        percent: 100,
        file: { current: 0, total: 0, currentFile: null, percent: 100 },
      });
      return {
        containerId: inspect.Id,
        containerName,
        status: 'skipped',
        mode: runMode,
        message: 'Nenhum volume selecionado para backup.',
      };
    }

    const containerBackup = {
      containerId: inspect.Id,
      containerName,
      backupScope,
      backupPaths: backupScope === 'container' ? ['/'] : activeMounts.map((mount) => mount.destination),
      mountSignature: mounts,
      archiveRelativePath,
      snapshotRelativePath,
      wasRunning: inspect.State?.Running === true,
      mode: runMode,
      status: 'ok',
    };

    const logs = [];
    const pushLog = (message, step = 'processando') => {
      const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${message}`;
      logs.push(line);
      while (logs.length > 40) {
        logs.shift();
      }

      onProgress({
        containerName,
        step,
        message,
        logs: [...logs],
      });
    };

    let fileTotal = 0;
    let fileCurrent = 0;
    const updateFileProgress = (currentFile = null) => {
      const filePercent = fileTotal > 0 ? Math.min(100, Math.round((fileCurrent / fileTotal) * 100)) : 0;
      onProgress({
        containerName,
        status: 'running',
        step: 'processando',
        percent: filePercent,
        file: {
          current: fileCurrent,
          total: fileTotal,
          currentFile,
          percent: filePercent,
        },
      });
    };

    try {
      if (backupScope === 'container' && !runInDocker) {
        throw new Error('Backup do container inteiro requer app executando via Docker.');
      }

      pushLog(`Escopo selecionado: ${backupScope === 'container' ? 'container inteiro' : 'somente volumes'}.`, 'preparando');

      if (runInDocker) {
        await this.dockerService.ensureLocalDirectory(backupRoot);
        pushLog(`Diretorio de backup pronto em ${backupRoot}.`, 'preparando');

        const originalRunning = inspect.State?.Running === true;
        let tempStarted = false;
        try {
          if (originalRunning) {
            pushLog('Container ativo detectado. Parando antes do backup.', 'preparando');
            await this.dockerService.stopContainer(containerId);
          }

          pushLog('Iniciando container temporariamente para snapshot.', 'preparando');
          await this.dockerService.repairAndStartContainer(containerId);
          tempStarted = true;

          const sourcePaths = backupScope === 'container'
            ? ['/']
            : activeMounts.map((mount) => mount.destination);
          const relSourcePaths = sourcePaths.map((item) => toContainerRelPath(item));

          if (backupScope === 'volumes') {
            pushLog('Contando arquivos para barra de progresso.', 'contando');
            const countCmd = `set -eu; TOTAL=0; for p in ${relSourcePaths.map((item) => shellQuote(item)).join(' ')}; do if [ -e \"/$p\" ]; then C=$(find \"/$p\" -type f 2>/dev/null | wc -l | tr -d \" \" ); TOTAL=$((TOTAL + C)); fi; done; echo \"$TOTAL\"`;
            const output = await this.dockerService.runContainerCommand(containerId, countCmd);
            const parsed = Number(output.split(/\r?\n/).pop());
            fileTotal = Number.isFinite(parsed) ? parsed : 0;
            pushLog(`Total de arquivos identificado: ${fileTotal}.`, 'contando');
          }

          const absoluteArchivePath = path.posix.join(backupRoot, archiveRelativePath);
          const snarInContainer = containerSnapshotPath(profile.id, containerId, backupScope);
          const absoluteSnapshotPath = path.posix.join(backupRoot, snapshotRelativePath);

          // Detecta se o container tem GNU tar (--listed-incremental é extensão GNU).
          // Containers Alpine/BusyBox usam o fallback --newer-mtime.
          const hasGnuTar = await this.dockerService.containerHasGnuTar(containerId);
          pushLog(`GNU tar detectado no container: ${hasGnuTar ? 'sim' : 'nao (usando --newer-mtime como fallback)'}.`, 'preparando');

          let tarIncrementalFlag = '';

          if (hasGnuTar) {
            // Gerencia o .snar assim como o script shell usa --listed-incremental=$dirbackup/backup.snar:
            // - Full: remove o .snar anterior do container para forçar snapshot limpo.
            // - Incremental: injeta o .snar salvo no diretório de backup de volta no container.
            if (runMode === 'full') {
              await this.dockerService.runContainerCommand(containerId, `rm -f ${shellQuote(snarInContainer)}`).catch(() => null);
              pushLog('Backup full: snapshot incremental anterior removido.', 'preparando');
            } else {
              try {
                await fs.access(absoluteSnapshotPath);
                await this.dockerService.putSnarToContainer(containerId, absoluteSnapshotPath, snarInContainer);
                pushLog('Backup incremental: snapshot anterior restaurado no container.', 'preparando');
              } catch {
                pushLog('Aviso: snapshot anterior nao encontrado, gerando backup completo.', 'preparando');
              }
            }
            tarIncrementalFlag = `--listed-incremental=${shellQuote(snarInContainer)}`;
          } else {
            // Fallback para containers sem GNU tar: usa helper container com GNU tar
            // montando os volumes diretamente — produz .snar como qualquer outro container.
            if (runMode === 'incremental') {
              try {
                await fs.access(absoluteSnapshotPath);
                tarIncrementalFlag = `--listed-incremental=${shellQuote('/backuproot/' + snapshotRelativePath)}`;
                pushLog('Backup incremental via helper: snapshot anterior encontrado.', 'preparando');
              } catch {
                pushLog('Aviso: snapshot anterior nao encontrado, gerando backup completo via helper.', 'preparando');
                tarIncrementalFlag = `--listed-incremental=${shellQuote('/backuproot/' + snapshotRelativePath)}`;
              }
            } else {
              // Full: remove .snar anterior para forçar snapshot limpo.
              await fs.rm(absoluteSnapshotPath, { force: true }).catch(() => null);
              tarIncrementalFlag = `--listed-incremental=${shellQuote('/backuproot/' + snapshotRelativePath)}`;
            }
          }

          // Containers BusyBox sem GNU tar: roda o tar num helper container que TEM GNU tar,
          // montando os volumes do container alvo diretamente.
          if (!hasGnuTar && backupScope === 'volumes' && activeMounts.length) {
            pushLog('Container sem GNU tar: usando helper com GNU tar para gerar archive.', 'gerando-tar');
            updateFileProgress();

            const helperBinds = [`${backupRoot}:/backuproot`];
            const helperRelPaths = [];
            for (const [index, mount] of activeMounts.entries()) {
              const src = mount.type === 'volume' ? mount.name : mount.source;
              helperBinds.push(`${src}:/payload/m${index}:ro`);
              helperRelPaths.push(`payload/m${index}`);
            }
            const helperArchivePath = `/backuproot/${archiveRelativePath}`;
            const helperSnarDir = path.posix.dirname(`/backuproot/${snapshotRelativePath}`);
            const helperCmd = [
              'set -u',
              `mkdir -p ${shellQuote(path.posix.dirname(helperArchivePath))} ${shellQuote(helperSnarDir)}`,
              `echo "__DBKP_TAR_BEGIN__" 1>&2`,
              `tar --ignore-failed-read ${tarIncrementalFlag} -czvf ${shellQuote(helperArchivePath)} -C / ${helperRelPaths.map((p) => shellQuote(p)).join(' ')}; TAR_RC=$?; [ $TAR_RC -le 1 ] || exit $TAR_RC`,
            ].join('; ');

            await this.dockerService.runHelper({
              binds: helperBinds,
              cmd: helperCmd,
              maxOkExitCode: 1,
              onOutput: (line, stream) => {
                const normalizedLine = String(line || '').trim();
                if (!normalizedLine || normalizedLine.startsWith('__DBKP_TAR_BEGIN__')) {
                  return;
                }
                // No helper (tar escreve em arquivo): lista de arquivos vai para stdout;
                // avisos do tar vão para stderr.
                if (stream === 'stdout' && !normalizedLine.startsWith('tar:')) {
                  fileCurrent += 1;
                  updateFileProgress(normalizedLine);
                } else if (stream === 'stderr') {
                  pushLog(`Aviso do tar: ${normalizedLine}`, 'gerando-tar');
                }
              },
            });

            pushLog(`Arquivo gerado via helper: ${absoluteArchivePath}`, 'finalizando');
            pushLog('Snapshot incremental salvo no diretorio de backup.', 'finalizando');

            onProgress({
              containerName,
              status: 'ok',
              step: 'concluido',
              message: 'Backup concluido com sucesso.',
              percent: 100,
              file: { current: Math.max(fileCurrent, fileTotal), total: fileTotal, currentFile: null, percent: 100 },
            });
            return containerBackup;
          }

          const tarParts = [
            'set -u',
            'umask 077',
            'echo "__DBKP_TAR_BEGIN__" 1>&2',
          ];

          // --ignore-failed-read é extensão GNU tar — não existe no BusyBox tar (Alpine).
          // Usar condicionalmente para evitar aborto silencioso com 0 bytes no arquivo.
          const gnuFlags = hasGnuTar ? '--ignore-failed-read' : '';

          // GNU tar: exit 0 = ok, exit 1 = avisos (arquivos mudaram, permissão negada), exit 2 = erro fatal.
          // Aceitamos exit 1 como sucesso para não descartar archives válidos com avisos menores.
          if (backupScope === 'container') {
            tarParts.push(
              `tar ${gnuFlags} ${tarIncrementalFlag} -czvf - -C / --exclude=proc --exclude=sys --exclude=dev --exclude=run --exclude=tmp .; TAR_RC=$?; [ $TAR_RC -le 1 ] || exit $TAR_RC`
            );
          } else {
            tarParts.push(
              `tar ${gnuFlags} ${tarIncrementalFlag} -czvf - -C / ${relSourcePaths.map((item) => shellQuote(item)).join(' ')}; TAR_RC=$?; [ $TAR_RC -le 1 ] || exit $TAR_RC`
            );
          }

          updateFileProgress();
          pushLog('Iniciando compactacao tar do container.', 'gerando-tar');

          await this.dockerService.streamContainerCommandToFile(containerId, tarParts.join('; '), absoluteArchivePath, {
            maxOkExitCode: 1,
            onOutput: (line, stream) => {
              const normalizedLine = String(line || '').trim();
              if (!normalizedLine || stream !== 'stderr' || normalizedLine.startsWith('__DBKP_TAR_BEGIN__')) {
                return;
              }

              if (!normalizedLine.startsWith('tar:')) {
                fileCurrent += 1;
                updateFileProgress(normalizedLine);
              } else {
                pushLog(`Aviso do tar: ${normalizedLine}`, 'gerando-tar');
              }
            },
          });

          pushLog(`Arquivo gerado: ${absoluteArchivePath}`, 'finalizando');

          // Persiste o .snar atualizado no diretório de backup (como o script shell faz com $dirbackup/backup.snar)
          // para que a cadeia incremental sobreviva a recriações do container.
          if (hasGnuTar) {
            const snarSaved = await this.dockerService.getSnarFromContainer(containerId, snarInContainer, absoluteSnapshotPath).catch(() => false);
            if (snarSaved) {
              pushLog('Snapshot incremental salvo no diretorio de backup.', 'finalizando');
            }
          }
        } finally {
          if (tempStarted) {
            pushLog('Encerrando container apos backup.', 'finalizando');
            await this.dockerService.stopContainer(containerId).catch(() => null);
          }

          if (originalRunning) {
            pushLog('Reiniciando container (estava ativo antes do backup).', 'finalizando');
            await this.dockerService.startContainer(containerId).catch(() => null);
          }
        }

        onProgress({
          containerName,
          status: 'ok',
          step: 'concluido',
          message: 'Backup concluido com sucesso.',
          percent: 100,
          file: {
            current: Math.max(fileCurrent, fileTotal),
            total: fileTotal,
            currentFile: null,
            percent: 100,
          },
        });

        return containerBackup;
      }

      if (backupScope === 'container') {
        throw new Error('Backup de container inteiro sem Docker nativo nao e suportado.');
      }

      await this.dockerService.ensureHostDirectory(backupRoot);
      const wasRunning = inspect.State?.Running === true;
      if (wasRunning) {
        await this.dockerService.stopContainer(containerId);
      }

      const binds = [`${backupRoot}:/backuproot`];
      for (const [index, mount] of activeMounts.entries()) {
        binds.push(`${getMountBindingSource(mount)}:/payload/m${index}:ro`);
      }

      const archivePath = `/backuproot/${archiveRelativePath}`;
      const snapshotPath = `/backuproot/${snapshotRelativePath}`;
      const parentDir = path.posix.dirname(archivePath);
      const cmdParts = ['set -eu', `mkdir -p ${shellQuote(parentDir)}`];
      if (runMode === 'full') {
        cmdParts.push(`rm -f ${shellQuote(snapshotPath)}`);
      }
      cmdParts.push('TOTAL_FILES=$(find /payload -type f | wc -l | tr -d " ")');
      cmdParts.push('echo "__DBKP_TOTAL_FILES__=${TOTAL_FILES}"');
      cmdParts.push(`tar --listed-incremental=${shellQuote(snapshotPath)} -czvf ${shellQuote(archivePath)} -C /payload .`);

      await this.dockerService.runHelper({
        binds,
        cmd: cmdParts.join(' && '),
        onOutput: (line, stream) => {
          const normalizedLine = String(line || '').trim();
          if (!normalizedLine) {
            return;
          }

          if (normalizedLine.startsWith('__DBKP_TOTAL_FILES__=')) {
            const parsed = Number(normalizedLine.split('=')[1]);
            fileTotal = Number.isFinite(parsed) ? parsed : 0;
            updateFileProgress();
            return;
          }

          if (stream === 'stdout' && !normalizedLine.startsWith('tar:')) {
            fileCurrent += 1;
            updateFileProgress(normalizedLine);
          }
        },
      });

      if (wasRunning) {
        await this.dockerService.startContainer(containerId).catch(() => null);
      }

      onProgress({
        containerName,
        status: 'ok',
        step: 'concluido',
        message: 'Backup concluido com sucesso.',
        percent: 100,
        file: {
          current: Math.max(fileCurrent, fileTotal),
          total: fileTotal,
          currentFile: null,
          percent: 100,
        },
      });

      return containerBackup;
    } catch (error) {
      onProgress({
        containerName,
        status: 'error',
        step: 'erro',
        message: error.message,
        percent: 100,
      });
      return {
        ...containerBackup,
        status: 'error',
        error: error.message,
      };
    }
  }

  async restoreBackup(profileId, backupId, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const selectedContainerIds = options.selectedContainerIds;

    const profile = await this.store.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile nao encontrado.');
    }

    const backupRun = await this.store.getBackup(backupId);
    if (!backupRun || backupRun.profileId !== profileId) {
      throw new Error('Backup nao encontrado para este profile.');
    }

    const allowedContainerIds = new Set(Array.isArray(selectedContainerIds) && selectedContainerIds.length
      ? selectedContainerIds
      : backupRun.containers.map((item) => item.containerId));

    const targets = backupRun.containers.filter((item) => item.status === 'ok' && allowedContainerIds.has(item.containerId));
    if (!targets.length) {
      throw new Error('Nenhum container valido foi selecionado para restore.');
    }

    const progress = {
      profileId: profile.id,
      profileName: profile.name,
      operation: 'restore',
      startedAt: new Date().toISOString(),
      status: 'running',
      overall: {
        total: targets.length,
        completed: 0,
        pending: targets.length,
        percent: 0,
      },
      currentContainer: null,
    };

    const emitProgress = () => {
      onProgress(JSON.parse(JSON.stringify(progress)));
    };

    emitProgress();

    const results = [];

    for (const containerEntry of targets) {
      const logs = [];
      const pushLog = (message, step = 'restaurando') => {
        const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${message}`;
        logs.push(line);
        while (logs.length > 40) {
          logs.shift();
        }

        progress.currentContainer = {
          ...(progress.currentContainer || {}),
          message,
          step,
          logs: [...logs],
        };
        emitProgress();
      };

      progress.currentContainer = {
        containerId: containerEntry.containerId,
        containerName: containerEntry.containerName,
        status: 'running',
        step: 'preparando',
        message: 'Preparando restauracao do container.',
        logs: [],
        percent: 0,
        file: {
          current: 0,
          total: 0,
          currentFile: null,
          percent: 0,
        },
      };
      emitProgress();

      try {
        const chain = await this.store.getBackupsForContainer(profileId, containerEntry.containerId, backupId);
        if (!chain.length || chain[0].mode !== 'full') {
          throw new Error(`Nao existe cadeia full + incremental valida para ${containerEntry.containerName}.`);
        }

        pushLog(`Cadeia de restore encontrada com ${chain.length} arquivo(s).`, 'preparando');

        const restoreInfo = await this.restoreContainer(profile, containerEntry, chain, {
          onProgress: (snapshot) => {
            progress.currentContainer = {
              ...progress.currentContainer,
              ...snapshot,
            };
            emitProgress();
          },
          pushLog,
        });

        progress.currentContainer = {
          ...progress.currentContainer,
          status: 'ok',
          step: 'concluido',
          message: 'Restore concluido com sucesso.',
          percent: 100,
          file: {
            ...(progress.currentContainer?.file || {}),
            percent: 100,
          },
        };
        emitProgress();

        results.push({
          containerId: containerEntry.containerId,
          containerName: containerEntry.containerName,
          status: 'ok',
          stats: restoreInfo?.stats || null,
        });
      } catch (error) {
        pushLog(`Falha no restore: ${error.message}`, 'erro');
        progress.currentContainer = {
          ...progress.currentContainer,
          status: 'error',
          step: 'erro',
          message: error.message,
          percent: 100,
        };
        emitProgress();

        results.push({
          containerId: containerEntry.containerId,
          containerName: containerEntry.containerName,
          status: 'error',
          error: error.message,
        });
      }

      progress.overall.completed += 1;
      progress.overall.pending = Math.max(0, progress.overall.total - progress.overall.completed);
      progress.overall.percent = progress.overall.total
        ? Math.round((progress.overall.completed / progress.overall.total) * 100)
        : 100;
      emitProgress();
    }

    progress.status = results.every((item) => item.status === 'ok') ? 'completed' : 'completed-with-errors';
    progress.finishedAt = new Date().toISOString();
    progress.currentContainer = null;
    progress.overall.percent = 100;
    progress.overall.pending = 0;
    emitProgress();

    return {
      backupId,
      status: results.every((item) => item.status === 'ok') ? 'ok' : 'partial',
      containers: results,
    };
  }

  async restoreContainer(profile, targetEntry, chain, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const pushLog = typeof options.pushLog === 'function' ? options.pushLog : () => {};

    const inspect = await this.dockerService.inspectContainer(targetEntry.containerId);
    const backupScope = normalizeBackupScope(targetEntry.backupScope || profile.backupScope);
    const currentMounts = normalizeMounts(inspect);

    if (backupScope === 'volumes' && !sameMountSignature(targetEntry.mountSignature, currentMounts)) {
      throw new Error(`Os mounts atuais do container ${targetEntry.containerName} nao batem com o backup selecionado.`);
    }

    const runInDocker = this.dockerService.isRunningInDocker();
    const useNativeRestore = runInDocker;

    if (useNativeRestore) {
      const backupRoot = normalizeContainerPath(profile.backupDir);
      const originalWasRunning = inspect.State?.Running === true;
      const restoreStats = { deleted: 0, created: 0, modified: 0 };

      try {
        if (originalWasRunning) {
          pushLog('Container ativo detectado. Parando antes do restore.', 'preparando');
          await this.dockerService.stopContainer(targetEntry.containerId);
        }

        if (backupScope === 'volumes') {
          const restorePaths = (chain[0]?.backupPaths && chain[0].backupPaths.length)
            ? chain[0].backupPaths
            : currentMounts.map((mount) => mount.destination);

          // Validar que todos os archives existem antes de tocar nos dados.
          for (const entry of chain) {
            await fs.access(path.posix.join(backupRoot, entry.archiveRelativePath));
          }

          // Restaurar via Docker API (putArchive) — funciona com container parado.
          // O archive foi gerado com -C / incluindo os caminhos relativos dos volumes,
          // portanto o destino do putArchive e sempre /.
          for (const [index, entry] of chain.entries()) {
            const absoluteArchivePath = path.posix.join(backupRoot, entry.archiveRelativePath);

            onProgress({
              step: 'restaurando',
              file: {
                current: index + 1,
                total: chain.length,
                currentFile: entry.archiveRelativePath,
                percent: Math.round(((index + 1) / chain.length) * 100),
              },
              percent: Math.round(((index + 1) / chain.length) * 100),
            });
            pushLog(`Aplicando arquivo ${index + 1}/${chain.length}: ${entry.archiveRelativePath}`, 'restaurando');

            await this.dockerService.putCompressedArchiveFromFile(
              targetEntry.containerId,
              '/',
              absoluteArchivePath,
            );
          }

          pushLog('Restore de volumes concluido.', 'finalizando');
        } else {
          // Escopo container inteiro.
          for (const entry of chain) {
            await fs.access(path.posix.join(backupRoot, entry.archiveRelativePath));
          }

          for (const [index, entry] of chain.entries()) {
            const absoluteArchivePath = path.posix.join(backupRoot, entry.archiveRelativePath);

            onProgress({
              step: 'restaurando',
              file: {
                current: index + 1,
                total: chain.length,
                currentFile: entry.archiveRelativePath,
                percent: Math.round(((index + 1) / chain.length) * 100),
              },
              percent: Math.round(((index + 1) / chain.length) * 100),
            });
            pushLog(`Aplicando arquivo ${index + 1}/${chain.length}: ${entry.archiveRelativePath}`, 'restaurando');

            await this.dockerService.putCompressedArchiveFromFile(targetEntry.containerId, '/', absoluteArchivePath);
          }

          pushLog('Restore do container concluido.', 'finalizando');
        }
      } finally {
        if (originalWasRunning) {
          pushLog('Reiniciando container (estava ativo antes do restore).', 'finalizando');
          await this.dockerService.startContainer(targetEntry.containerId).catch(() => null);
        }
      }

      return { stats: restoreStats };
    }

    if (backupScope === 'container') {
      throw new Error('Restore do container inteiro requer app executando via Docker.');
    }

    const backupRoot = normalizeDockerHostPath(profile.backupDir);
    const wasRunning = inspect.State?.Running === true;
    const binds = [`${backupRoot}:/backuproot:ro`];
    for (const [index, mount] of currentMounts.entries()) {
      binds.push(`${getMountBindingSource(mount)}:/restore/m${index}`);
    }

    const cleanupCommands = currentMounts.map((_mount, index) => (
      `find ${shellQuote(`/restore/m${index}`)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`
    ));

    const restoreCommands = chain.map((entry) => (
      `tar --listed-incremental=/dev/null -xzf ${shellQuote(`/backuproot/${entry.archiveRelativePath}`)} -C /restore`
    ));

    try {
      if (wasRunning) {
        await this.dockerService.stopContainer(targetEntry.containerId);
      }

      const cmd = ['set -eu', ...cleanupCommands, ...restoreCommands].join(' && ');
      await this.dockerService.runHelper({ binds, cmd });
    } finally {
      if (wasRunning) {
        await this.dockerService.startContainer(targetEntry.containerId).catch(() => null);
      }
    }

    return { stats: null };
  }
}

module.exports = BackupService;
