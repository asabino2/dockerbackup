const Docker = require('dockerode');
const { PassThrough } = require('stream');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

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
  constructor({ socketPath, helperImage }) {
    this.docker = new Docker({ socketPath });
    this.helperImage = helperImage;
    this.runningInContainer = detectRunningInContainer();
  }

  isRunningInDocker() {
    return this.runningInContainer;
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
      Cmd: ['sh', '-lc', `mkdir -p ${shellQuote(`/hostfs${normalized}`)}`],
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
      Cmd: ['sh', '-lc', cmd],
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
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: ['sh', '-lc', cmd],
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

    if (info.ExitCode !== 0) {
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
      Cmd: ['sh', '-lc', 'tar --listed-incremental=/dev/null -xzf - -C /'],
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
      const child = spawn('sh', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
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

  async runHelper({ binds, cmd, onOutput }) {
    await this.ensureImage();

    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-lc', cmd],
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
      await Promise.all(outputPromises);

      output = output.trim();

      if (result.StatusCode !== 0) {
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