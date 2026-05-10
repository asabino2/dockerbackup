const Docker = require('dockerode');
const { PassThrough, Readable } = require('stream');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

// Cria um arquivo tar POSIX em memÃ³ria contendo um Ãºnico arquivo.
// Usado para injetar o .snar no container sem depender do tar do sistema.
function buildSingleFileTar(filename, contentBuffer) {
  const header = Buffer.alloc(512, 0);
  Buffer.from(filename.slice(0, 100), 'ascii').copy(header, 0);
  Buffer.from('0000644\0', 'ascii').copy(header, 100); // mode
  Buffer.from('0000000\0', 'ascii').copy(header, 108); // uid
  Buffer.from('0000000\0', 'ascii').copy(header, 116); // gid
  Buffer.from(`${contentBuffer.length.toString(8).padStart(11, '0')} `, 'ascii').copy(header, 124); // size
  Buffer.from(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')} `, 'ascii').copy(header, 136); // mtime
  header[156] = 0x30; // type flag: regular file
  Buffer.from('ustar\0', 'ascii').copy(header, 257); // magic
  Buffer.from('00', 'ascii').copy(header, 263); // version
  // Checksum: calcular com campo de checksum como espaÃ§os
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'ascii').copy(header, 148);
  // Dados com padding para mÃºltiplo de 512
  const paddedLength = Math.ceil(contentBuffer.length / 512) * 512 || 512;
  const dataBlock = Buffer.alloc(paddedLength, 0);
  contentBuffer.copy(dataBlock);
  return Buffer.concat([header, dataBlock, Buffer.alloc(1024, 0)]);
}

// Extrai o conteÃºdo do primeiro arquivo de um tar nÃ£o comprimido em memÃ³ria.
function extractFirstFileFromTar(tarBuffer) {
  if (!tarBuffer || tarBuffer.length < 512) return null;
  const sizeField = tarBuffer.slice(124, 136).toString('ascii').replace(/[\0 ]/g, '').trim();
  const size = parseInt(sizeField, 8);
  if (!size || !Number.isFinite(size) || size <= 0 || size > tarBuffer.length - 512) return null;
  return tarBuffer.slice(512, 512 + size);
}

function detectRunningInContainer() {
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }

  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return /(docker|containerd|kubepods|cri-o)/i.test(cgroup);
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `"'"'`)}'`;
}

class DockerService {
  constructor({ socketPath, host, port, helperImage }) {
    if (host) {
      this.docker = new Docker({ host, port: port || 2375, protocol: 'http' });
    } else {
      this.docker = new Docker({ socketPath: socketPath || '/var/run/docker.sock' });
    }
    this.helperImage = helperImage;
    this.runningInContainer = detectRunningInContainer();
    this._selfMounts = null; // cache dos mounts do próprio container
  }

  isRunningInDocker() {
    return this.runningInContainer;
  }

  // Retorna os mounts do container da própria aplicação.
  // Lê /etc/hostname para obter o short ID, busca o container na lista e inspeciona.
  async _getSelfMounts() {
    if (this._selfMounts !== null) return this._selfMounts;
    try {
      const hostname = fs.readFileSync('/etc/hostname', 'utf8').trim();
      const all = await this.docker.listContainers({ all: true });
      const self = all.find((c) => c.Id.startsWith(hostname));
      if (!self) { this._selfMounts = []; return []; }
      const info = await this.docker.getContainer(self.Id).inspect();
      this._selfMounts = info.Mounts || [];
    } catch {
      this._selfMounts = [];
    }
    return this._selfMounts;
  }

  // Dado um caminho absoluto dentro do container da app (ex: /app/data/backups),
  // retorna { source, suffix } onde source é o bind/volume que cobre o caminho
  // e suffix é o subpath dentro desse mount (ex: source='data_vol', suffix='/backups').
  // Retorna null se não encontrar mount correspondente.
  async getSelfBindSource(containerPath) {
    const mounts = await this._getSelfMounts();
    const normalized = containerPath.replace(/\/+$/, '');
    // Ordena do mais específico para o mais genérico
    const sorted = [...mounts].sort(
      (a, b) => (b.Destination || '').length - (a.Destination || '').length
    );
    for (const mount of sorted) {
      const dest = (mount.Destination || '').replace(/\/+$/, '');
      if (normalized === dest || normalized.startsWith(dest + '/')) {
        const source = mount.Type === 'volume' ? mount.Name : mount.Source;
        const suffix = normalized.slice(dest.length) || '';
        return { source, suffix };
      }
    }
    return null;
  }

  async listContainers() {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .map((container) => ({
        id: container.Id,
        name: (container.Names[0] || '').replace(/^\//, ''),
        image: container.Image,
        state: container.State,
        status: container.Status,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async inspectContainer(containerId) {
    return this.docker.getContainer(containerId).inspect();
  }

  async stopContainer(containerId) {
    await this.docker.getContainer(containerId).stop();
  }

  async startContainer(containerId) {
    await this.docker.getContainer(containerId).start();
  }

  // Tenta iniciar o container. Se falhar por redes órfãs (network not found),
  // desconecta as redes inexistentes e tenta iniciar novamente uma vez.
  async repairAndStartContainer(containerId) {
    try {
      await this.startContainer(containerId);
      return;
    } catch (firstError) {
      const msg = String(firstError.message || '');
      const isNetworkError = /network.*not found|failed to set up container networking/i.test(msg);
      if (!isNetworkError) {
        throw firstError;
      }
    }

    // Identifica as redes do container e remove as que não existem mais.
    const inspect = await this.docker.getContainer(containerId).inspect();
    const networkNames = Object.keys(inspect.NetworkSettings?.Networks || {});
    let repaired = false;

    for (const networkName of networkNames) {
      try {
        await this.docker.getNetwork(networkName).inspect();
      } catch {
        // Rede não existe — desconecta o container forçadamente.
        try {
          await this.docker.getNetwork(networkName).disconnect({ Container: containerId, Force: true });
          repaired = true;
        } catch {
          // Ignora: a rede já foi removida do endpoint.
        }
      }
    }

    if (!repaired) {
      // Tenta uma segunda vez mesmo sem reparação detectável.
    }

    await this.startContainer(containerId);
  }

  async ensureImage(imageName = this.helperImage) {
    try {
      await this.docker.getImage(imageName).inspect();
      return;
    } catch {
      const stream = await this.docker.pull(imageName);
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }

  async ensureHostDirectory(hostPath) {
    const normalized = String(hostPath || '').trim().replace(/\\/g, '/');
    if (!normalized || !normalized.startsWith('/')) {
      throw new Error(`Diretorio de backup invalido: ${hostPath}`);
    }

    if (this.runningInContainer) {
      throw new Error('App rodando em container nao deve criar helper para backup/restore.');
    }

    await this.ensureImage();

    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-c', `mkdir -p ${shellQuote(`/hostfs${normalized}`)}`],
      Tty: false,
      HostConfig: {
        Binds: ['/:/hostfs'],
        AutoRemove: false,
        NetworkMode: 'none',
      },
    });

    try {
      await container.start();
      const [result, logs] = await Promise.all([
        container.wait(),
        container.logs({ stdout: true, stderr: true, follow: false }),
      ]);

      if (result.StatusCode !== 0) {
        throw new Error(logs.toString('utf8').trim() || 'Falha ao criar diretorio de backup no host.');
      }
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
      }
    }
  }

  async ensureLocalDirectory(localPath) {
    const normalized = String(localPath || '').trim().replace(/\\/g, '/');
    if (!normalized || !normalized.startsWith('/')) {
      throw new Error(`Diretorio de backup invalido: ${localPath}`);
    }

    await fsp.mkdir(normalized, { recursive: true });
  }

  async exportContainerPathArchive(containerId, containerPath, targetFilePath) {
    const container = this.docker.getContainer(containerId);
    const archiveStream = await container.getArchive({ path: containerPath });
    await fsp.mkdir(path.dirname(targetFilePath), { recursive: true });
    await pipeline(archiveStream, fs.createWriteStream(targetFilePath));
  }

  async putArchiveFromFile(containerId, destinationPath, sourceFilePath) {
    const container = this.docker.getContainer(containerId);
    const source = fs.createReadStream(sourceFilePath);
    await container.putArchive(source, { path: destinationPath });
  }

  async putCompressedArchiveFromFile(containerId, destinationPath, sourceFilePath) {
    const container = this.docker.getContainer(containerId);
    const source = fs.createReadStream(sourceFilePath).pipe(zlib.createGunzip());
    await container.putArchive(source, { path: destinationPath });
  }

  async runContainerCommand(containerId, cmd) {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: ['sh', '-c', cmd],
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    let output = '';
    stdoutStream.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    stderrStream.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });

    let info = await exec.inspect();
    while (info.Running) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      info = await exec.inspect();
    }

    if (typeof stream.destroy === 'function') {
      stream.destroy();
    }
    stdoutStream.end();
    stderrStream.end();

    const trimmed = output.trim();
    if (info.ExitCode !== 0) {
      throw new Error(output.trim() || `Comando em container terminou com codigo ${info.ExitCode}`);
    }

    return trimmed;
  }

  async streamContainerCommandToFile(containerId, cmd, targetFilePath, options = {}) {
    const onOutput = typeof options.onOutput === 'function' ? options.onOutput : () => {};
    const maxOkExitCode = typeof options.maxOkExitCode === 'number' ? options.maxOkExitCode : 0;
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: ['sh', '-c', cmd],
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    await fsp.mkdir(path.dirname(targetFilePath), { recursive: true });
    const writeStream = fs.createWriteStream(targetFilePath);
    stdoutStream.pipe(writeStream);

    const stderrDone = new Promise((resolve) => {
      let buffer = '';

      stderrStream.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        buffer += text;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() || '';
        for (const line of parts) {
          onOutput(line, 'stderr');
        }
      });

      stderrStream.on('end', () => {
        if (buffer) {
          onOutput(buffer, 'stderr');
        }
        resolve();
      });
    });

    let info = await exec.inspect();
    while (info.Running) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      info = await exec.inspect();
    }

    if (typeof stream.destroy === 'function') {
      stream.destroy();
    }
    stdoutStream.end();
    stderrStream.end();

    await Promise.all([
      stderrDone,
      new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      }),
    ]);

    if (info.ExitCode > maxOkExitCode) {
      throw new Error(`Comando de stream em container terminou com codigo ${info.ExitCode}`);
    }
  }

  async copyFileToContainer(containerId, sourceFilePath, destinationDirInContainer) {
    const container = this.docker.getContainer(containerId);
    const tarProc = spawn('tar', ['-cf', '-', '-C', path.dirname(sourceFilePath), path.basename(sourceFilePath)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    tarProc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    await container.putArchive(tarProc.stdout, { path: destinationDirInContainer });

    await new Promise((resolve, reject) => {
      tarProc.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `Falha ao empacotar arquivo para copia (codigo ${code})`));
      });
      tarProc.on('error', reject);
    });
  }

  async streamArchiveToContainer(containerId, archiveFilePath) {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdin: true,
      AttachStdout: false,
      AttachStderr: true,
      Tty: false,
      Cmd: ['sh', '-c', 'tar --listed-incremental=/dev/null -xzf - -C /'],
    });

    const attachStream = await exec.start({ hijack: true, stdin: true });
    const stderrStream = new PassThrough();
    this.docker.modem.demuxStream(attachStream, new PassThrough(), stderrStream);

    let stderrOutput = '';
    stderrStream.on('data', (chunk) => {
      stderrOutput += chunk.toString('utf8');
    });

    // Pipar o arquivo diretamente para o stdin do tar no container
    const fileReadStream = fs.createReadStream(archiveFilePath);
    await new Promise((resolve, reject) => {
      fileReadStream.on('error', reject);
      fileReadStream.on('end', () => {
        try { attachStream.end(); } catch { /* ignore */ }
        resolve();
      });
      fileReadStream.pipe(attachStream, { end: false });
    });

    // Aguardar tar finalizar
    let info = await exec.inspect();
    while (info.Running) {
      await new Promise((r) => setTimeout(r, 120));
      info = await exec.inspect();
    }

    if (typeof attachStream.destroy === 'function') {
      attachStream.destroy();
    }

    if (info.ExitCode !== 0) {
      throw new Error(stderrOutput.trim() || `Falha ao restaurar archive no container (codigo ${info.ExitCode})`);
    }
  }

  async copyFileFromContainer(containerId, containerFilePath, localFilePath) {
    const container = this.docker.getContainer(containerId);
    let archiveStream;
    try {
      archiveStream = await container.getArchive({ path: containerFilePath });
    } catch {
      return false;
    }

    await fsp.mkdir(path.dirname(localFilePath), { recursive: true });

    await new Promise((resolve, reject) => {
      const tarProc = spawn('tar', ['-xOf', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const writeStream = fs.createWriteStream(localFilePath);
      archiveStream.pipe(tarProc.stdin);
      tarProc.stdout.pipe(writeStream);
      tarProc.on('close', (code) => {
        if (code === 0) { resolve(); return; }
        reject(new Error(`Falha ao extrair arquivo do container (codigo ${code})`));
      });
      tarProc.on('error', reject);
      writeStream.on('error', reject);
    });

    return true;
  }

  async runHostCommand({ cmd, onOutput }) {
    await new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';

      const streamOutput = (stream, streamName) => {
        let buffer = '';

        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          output += text;

          if (typeof onOutput !== 'function') {
            return;
          }

          buffer += text;
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() || '';
          for (const line of parts) {
            onOutput(line, streamName);
          }
        });

        stream.on('end', () => {
          if (buffer && typeof onOutput === 'function') {
            onOutput(buffer, streamName);
          }
        });
      };

      streamOutput(child.stdout, 'stdout');
      streamOutput(child.stderr, 'stderr');

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        const trimmedOutput = output.trim();
        if (code !== 0) {
          reject(new Error(trimmedOutput || `Comando local terminou com codigo ${code}`));
          return;
        }

        resolve(trimmedOutput);
      });
    });
  }

  // Retorna true se o container tem GNU tar (suporta --listed-incremental).
  // Containers Alpine/BusyBox retornam false e devem usar --newer-mtime como fallback.
  async containerHasGnuTar(containerId) {
    try {
      const output = await this.runContainerCommand(containerId, 'tar --version 2>/dev/null | head -1');
      return /GNU tar/i.test(output);
    } catch {
      return false;
    }
  }

  // Injeta um arquivo .snar local no container no caminho absoluto informado.
  // Usa tar POSIX em memÃ³ria, sem depender do tar do sistema.
  async putSnarToContainer(containerId, localSnarPath, containerSnarPath) {
    const content = await fsp.readFile(localSnarPath);
    const filename = path.posix.basename(containerSnarPath);
    const containerDir = path.posix.dirname(containerSnarPath);
    const tarBuffer = buildSingleFileTar(filename, content);
    const container = this.docker.getContainer(containerId);
    await container.putArchive(Readable.from([tarBuffer]), { path: containerDir });
  }

  // Extrai o arquivo .snar do container e salva no caminho local informado.
  // Retorna true se conseguiu, false se o arquivo nÃ£o existe no container.
  async getSnarFromContainer(containerId, containerSnarPath, localSnarPath) {
    const container = this.docker.getContainer(containerId);
    let archiveStream;
    try {
      archiveStream = await container.getArchive({ path: containerSnarPath });
    } catch {
      return false;
    }
    const chunks = [];
    await new Promise((resolve, reject) => {
      archiveStream.on('data', (chunk) => chunks.push(chunk));
      archiveStream.on('end', resolve);
      archiveStream.on('error', reject);
    });
    const content = extractFirstFileFromTar(Buffer.concat(chunks));
    if (!content) return false;
    await fsp.mkdir(path.dirname(localSnarPath), { recursive: true });
    await fsp.writeFile(localSnarPath, content);
    return true;
  }

  // Igual ao runHelper, mas redireciona stdout para um arquivo local.
  // Usado para containers BusyBox (sem GNU tar): monta os volumes no helper que TEM GNU tar
  // e gera o archive + .snar diretamente no diretório de backup.
  async runHelperStreamToFile({ binds, cmd, targetFilePath, onOutput, maxOkExitCode = 0 }) {
    await this.ensureImage();

    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-c', cmd],
      Tty: false,
      HostConfig: {
        Binds: binds,
        AutoRemove: false,
        NetworkMode: 'none',
      },
    });

    let attachStream;

    try {
      attachStream = await container.attach({ stream: true, stdout: true, stderr: true });
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      this.docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);

      await fsp.mkdir(path.dirname(targetFilePath), { recursive: true });
      const writeStream = fs.createWriteStream(targetFilePath);
      stdoutStream.pipe(writeStream);

      const stderrDone = new Promise((resolve) => {
        let buffer = '';
        stderrStream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          buffer += text;
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() || '';
          for (const line of parts) {
            if (typeof onOutput === 'function') onOutput(line, 'stderr');
          }
        });
        stderrStream.on('end', () => {
          if (buffer && typeof onOutput === 'function') onOutput(buffer, 'stderr');
          resolve();
        });
      });

      await container.start();
      const result = await container.wait();

      if (attachStream && typeof attachStream.destroy === 'function') {
        attachStream.destroy();
      }
      stdoutStream.end();
      stderrStream.end();

      await Promise.all([
        stderrDone,
        new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        }),
      ]);

      if (result.StatusCode > maxOkExitCode) {
        throw new Error(`Helper (stream) terminou com codigo ${result.StatusCode}`);
      }
    } finally {
      if (attachStream && typeof attachStream.destroy === 'function') {
        try { attachStream.destroy(); } catch { /* ignore */ }
      }
      try { await container.remove({ force: true }); } catch { /* ignore */ }
    }
  }

  async runHelper({ binds, cmd, onOutput, maxOkExitCode = 0 }) {
    await this.ensureImage();

    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-c', cmd],
      Tty: false,
      HostConfig: {
        Binds: binds,
        AutoRemove: false,
        NetworkMode: 'none',
      },
    });

    let attachStream;

    try {
      attachStream = await container.attach({ stream: true, stdout: true, stderr: true });
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      this.docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);

      const parseOutput = (stream, streamName) => new Promise((resolve) => {
        let buffer = '';

        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          output += text;

          if (typeof onOutput !== 'function') {
            return;
          }

          buffer += text;
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() || '';

          for (const line of parts) {
            onOutput(line, streamName);
          }
        });

        stream.on('end', () => {
          if (buffer && typeof onOutput === 'function') {
            onOutput(buffer, streamName);
          }
          resolve();
        });
      });

      let output = '';
      const outputPromises = [
        parseOutput(stdoutStream, 'stdout'),
        parseOutput(stderrStream, 'stderr'),
      ];

      await container.start();
      const result = await container.wait();

      // Destruir o attachStream para que os PassThrough streams emitam 'end'
      // e as outputPromises possam resolver. Sem isso o runHelper trava indefinidamente.
      if (attachStream && typeof attachStream.destroy === 'function') {
        attachStream.destroy();
      }
      stdoutStream.end();
      stderrStream.end();

      await Promise.all(outputPromises);

      output = output.trim();

      if (result.StatusCode > maxOkExitCode) {
        throw new Error(output || `Helper container terminou com codigo ${result.StatusCode}`);
      }

      return output;
    } finally {
      if (attachStream && typeof attachStream.destroy === 'function') {
        attachStream.destroy();
      }

      try {
        await container.remove({ force: true });
      } catch {
      }
    }
  }
}

module.exports = DockerService;
