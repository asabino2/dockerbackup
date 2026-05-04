const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify({ profiles: [], backups: [] }, null, 2));
    }
  }

  async read() {
    const raw = await fs.readFile(this.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.profiles ||= [];
    parsed.backups ||= [];
    return parsed;
  }

  async write(mutator) {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.read();
      const next = await mutator(current);
      await fs.writeFile(this.filePath, JSON.stringify(next, null, 2));
      return next;
    });

    return this.writeQueue;
  }

  async listProfiles() {
    const data = await this.read();
    return data.profiles;
  }

  async getProfile(profileId) {
    const data = await this.read();
    return data.profiles.find((profile) => profile.id === profileId) || null;
  }

  async saveProfile(profileInput) {
    const now = new Date().toISOString();
    const profile = {
      id: profileInput.id || randomUUID(),
      name: profileInput.name,
      containerIds: profileInput.containerIds,
      mode: profileInput.mode,
      backupScope: profileInput.backupScope || 'volumes',
      backupDir: profileInput.backupDir,
      updatedAt: now,
      createdAt: profileInput.createdAt || now,
    };

    await this.write((data) => {
      const index = data.profiles.findIndex((item) => item.id === profile.id);
      if (index >= 0) {
        data.profiles[index] = profile;
      } else {
        data.profiles.push(profile);
      }
      return data;
    });

    return profile;
  }

  async deleteProfile(profileId) {
    await this.write((data) => {
      data.profiles = data.profiles.filter((profile) => profile.id !== profileId);
      data.backups = data.backups.filter((backup) => backup.profileId !== profileId);
      return data;
    });
  }

  async addBackup(backupRun) {
    await this.write((data) => {
      data.backups.unshift(backupRun);
      return data;
    });
    return backupRun;
  }

  async listBackups(profileId) {
    const data = await this.read();
    return data.backups.filter((backup) => backup.profileId === profileId);
  }

  async getBackup(backupId) {
    const data = await this.read();
    return data.backups.find((backup) => backup.id === backupId) || null;
  }

  async getBackupsForContainer(profileId, containerId, upToBackupId) {
    const backups = await this.listBackups(profileId);
    const ordered = backups
      .slice()
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    const chain = [];

    for (const backup of ordered) {
      const containerBackup = backup.containers.find(
        (item) => item.containerId === containerId && item.status === 'ok' && item.archiveRelativePath,
      );

      if (!containerBackup) {
        if (backup.id === upToBackupId) {
          return chain;
        }
        continue;
      }

      if (containerBackup.mode === 'full') {
        chain.length = 0;
      }

      chain.push({
        backupId: backup.id,
        createdAt: backup.createdAt,
        ...containerBackup,
      });

      if (backup.id === upToBackupId) {
        return chain;
      }
    }

    return [];
  }
  async getLastContainerBackupTime(profileId, containerId) {
    const backups = await this.listBackups(profileId);
    const ordered = backups
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    for (const backup of ordered) {
      const found = backup.containers.find(
        (item) => item.containerId === containerId && item.status === 'ok',
      );
      if (found) {
        return backup.createdAt;
      }
    }

    return null;
  }
}

module.exports = JsonStore;