const state = {
  containers: [],
  profiles: [],
  activeRuns: new Map(),
  volumeSelections: {},
};

const elements = {
  containerCount: document.querySelector('#containerCount'),
  profileCount: document.querySelector('#profileCount'),
  profileForm: document.querySelector('#profileForm'),
  profileId: document.querySelector('#profileId'),
  profileName: document.querySelector('#profileName'),
  backupDir: document.querySelector('#backupDir'),
  containerOptions: document.querySelector('#containerOptions'),
  profilesList: document.querySelector('#profilesList'),
  toast: document.querySelector('#toast'),
  profileFormModal: document.querySelector('#profileFormModal'),
  profileModalClose: document.querySelector('#profileModalClose'),
  restoreModal: document.querySelector('#restoreModal'),
  restoreModalSubtitle: document.querySelector('#restoreModalSubtitle'),
  restoreContainerOptions: document.querySelector('#restoreContainerOptions'),
  restoreModalConfirm: document.querySelector('#restoreModalConfirm'),
  restoreModalClose: document.querySelector('#restoreModalClose'),
  restoreModalSelectAll: document.querySelector('#restoreModalSelectAll'),
  volumePickerModal: document.querySelector('#volumePickerModal'),
  volumePickerSubtitle: document.querySelector('#volumePickerSubtitle'),
  volumePickerOptions: document.querySelector('#volumePickerOptions'),
  volumePickerConfirm: document.querySelector('#volumePickerConfirm'),
  volumePickerClose: document.querySelector('#volumePickerClose'),
  volumePickerSelectAll: document.querySelector('#volumePickerSelectAll'),
};

// ─── View navigation ──────────────────────────────────────
function navigateTo(viewName) {
  for (const view of document.querySelectorAll('.view')) {
    view.classList.add('hidden');
  }
  const target = document.querySelector(`#view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
  }
  for (const item of document.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.view === viewName);
  }
  if (viewName === 'profiles') {
    loadProfiles();
    loadContainers();
  }
  if (viewName === 'servers') {
    renderServers();
  }
  if (viewName === 'runs') {
    loadAllRuns();
  }
  if (viewName === 'backups') {
    renderBackupsView();
  }
}

document.querySelector('.sidebar').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item[data-view]');
  if (btn) {
    navigateTo(btn.dataset.view);
  }
});

document.querySelector('#createProfileBtn')?.addEventListener('click', () => navigateTo('profiles'));
document.querySelector('#refreshServers')?.addEventListener('click', () => renderServers());

// ─── Profile form modal ───────────────────────────────────
function openProfileModal(title = 'Novo Profile') {
  document.querySelector('#profileModalTitle').textContent = title;
  elements.profileFormModal.classList.remove('hidden');
  elements.profileFormModal.setAttribute('aria-hidden', 'false');
}

function closeProfileModal() {
  elements.profileFormModal.classList.add('hidden');
  elements.profileFormModal.setAttribute('aria-hidden', 'true');
}

document.querySelector('#openCreateProfileModal')?.addEventListener('click', () => {
  resetForm();
  openProfileModal('Novo Profile');
});

elements.profileModalClose?.addEventListener('click', closeProfileModal);

elements.profileFormModal?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-profile-modal"]')) {
    closeProfileModal();
  }
});

function renderServers() {
  const list = document.querySelector('#serversList');
  if (!list) return;
  if (!state.containers.length) {
    list.innerHTML = '<p class="empty-state">Nenhum servidor encontrado.</p>';
    return;
  }
  list.innerHTML = state.containers.map((c) => `
    <div class="server-card">
      <h3>${escapeHtml(c.name)}</h3>
      <small>${escapeHtml(c.image)}</small>
      <small>${escapeHtml(c.status)} · <span class="state ${escapeHtml(c.state)}">${escapeHtml(c.state)}</span></small>
    </div>
  `).join('');
}

async function renderBackupsView() {
  const host = document.querySelector('#backupsViewList');
  if (!host) return;
  if (!state.profiles.length) {
    host.innerHTML = '<div class="card"><p class="empty-state">Nenhum profile encontrado.</p></div>';
    return;
  }
  const rows = await Promise.all(state.profiles.map(async (p) => {
    const backups = await api(`/api/profiles/${p.id}/backups`);
    return { profile: p, backups };
  }));
  host.innerHTML = rows.map(({ profile, backups }) => `
    <div class="card">
      <div class="card-toolbar">
        <h2 class="card-title">${escapeHtml(profile.name)}</h2>
        <span class="badge">${escapeHtml(String(backups.length))} backup(s)</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Data</th><th>Mode</th><th>Status</th><th>Containers</th><th>Actions</th></tr></thead>
          <tbody>
            ${backups.length ? backups.map((b) => {
              const hasRestorable = (b.containers || []).some((c) => c.status === 'ok');
              return `
              <tr>
                <td>${escapeHtml(new Date(b.createdAt).toLocaleString('pt-BR'))}</td>
                <td>${escapeHtml(b.mode || '—')}</td>
                <td><span class="status-badge status-badge--${escapeHtml(b.status)}">${escapeHtml(b.status)}</span></td>
                <td>${escapeHtml((b.containers || []).map((c) => c.containerName).join(', '))}</td>
                <td>
                  <button
                    class="btn btn--secondary btn--sm"
                    data-action="restore"
                    data-profile-id="${escapeHtml(profile.id)}"
                    data-backup-id="${escapeHtml(b.id)}"
                    ${hasRestorable ? '' : 'disabled title="Nenhum container restaurável"'}
                  >Restore</button>
                </td>
              </tr>
            `}).join('') : '<tr><td colspan="5" class="empty-row">Nenhum backup realizado.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');
}

async function updateDashboard() {
  const allBackups = (await Promise.all(
    state.profiles.map((p) => api(`/api/profiles/${p.id}/backups`))
  )).flat();

  // Last successful
  const successful = allBackups
    .filter((b) => b.status === 'ok' || b.status === 'partial')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const lastBackupEl = document.querySelector('#lastBackupTime');
  if (lastBackupEl) {
    lastBackupEl.textContent = String(successful.length);
  }

  // Failed total
  const failed = allBackups.filter((b) => b.status === 'error');
  const failedEl = document.querySelector('#failedCount');
  if (failedEl) failedEl.textContent = String(failed.length);

  // Recent runs table
  const recent = [...allBackups]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);

  const tbody = document.querySelector('#recentRunsBody');
  if (!tbody) return;

  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum run encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map((b, index) => {
    const profile = state.profiles.find((p) => p.id === b.profileId);
    const profileName = profile ? profile.name : (b.profileName || b.profileId || '—');
    const started = new Date(b.createdAt).toLocaleString('pt-BR');
    const duration = '—';
    const fileCount = (b.containers || []).reduce((sum, c) => sum + (c.fileCount || 0), 0);
    const size = (b.containers || []).reduce((sum, c) => sum + (c.archiveSize || 0), 0);
    const sizeStr = size > 0 ? formatBytes(size) : '—';
    return `
      <tr>
        <td>#${index + 1}</td>
        <td><a href="#" class="profile-link" data-profile-id="${escapeHtml(b.profileId)}">${escapeHtml(profileName)}</a></td>
        <td><span class="status-badge status-badge--${escapeHtml(b.status)}">${escapeHtml(b.status === 'ok' ? 'Completed' : b.status)}</span></td>
        <td>${fileCount || '—'}</td>
        <td>${sizeStr}</td>
        <td>${started}</td>
        <td>${duration}</td>
        <td><button class="btn btn--ghost btn--sm" disabled>🗑</button></td>
      </tr>
    `;
  }).join('');

  document.querySelector('#recentRunsBody')?.addEventListener('click', (e) => {
    const link = e.target.closest('.profile-link');
    if (link) {
      e.preventDefault();
      navigateTo('profiles');
    }
  }, { once: true });
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

async function loadAllRuns() {
  const tbody = document.querySelector('#allRunsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Carregando...</td></tr>';

  if (!state.profiles.length) {
    await loadProfiles();
  }

  if (!state.profiles.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum profile encontrado.</td></tr>';
    return;
  }

  const allBackups = (await Promise.all(
    state.profiles.map((p) => api(`/api/profiles/${p.id}/backups`)),
  )).flat();

  const sorted = [...allBackups].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum run encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map((b, index) => {
    const profile = state.profiles.find((p) => p.id === b.profileId);
    const profileName = profile ? profile.name : (b.profileName || b.profileId || '—');
    const containers = (b.containers || []).map((c) => escapeHtml(c.containerName || c.containerId?.slice(0, 12) || '?')).join(', ');
    const fileCount = (b.containers || []).reduce((sum, c) => sum + (c.fileCount || 0), 0);
    const size = (b.containers || []).reduce((sum, c) => sum + (c.archiveSize || 0), 0);
    const sizeStr = size > 0 ? formatBytes(size) : '—';
    const statusLabel = b.status === 'ok' ? 'Completed' : b.status === 'partial' ? 'Partial' : 'Error';
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(profileName)}</td>
        <td>${escapeHtml(b.mode || '—')}</td>
        <td><span class="status-badge status-badge--${escapeHtml(b.status)}">${escapeHtml(statusLabel)}</span></td>
        <td>${containers || '—'}</td>
        <td>${fileCount || '—'}</td>
        <td>${sizeStr}</td>
        <td>${escapeHtml(new Date(b.createdAt).toLocaleString('pt-BR'))}</td>
      </tr>
    `;
  }).join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Falha na requisicao');
  }

  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden', 'error');
  if (isError) {
    elements.toast.classList.add('error');
  }

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3200);
}

function getSelectedContainerIds() {
  return [...document.querySelectorAll('input[name="containerIds"]:checked')].map((input) => input.value);
}

const SYSTEM_MOUNT_PREFIXES = ['/dev', '/proc', '/sys', '/run', '/tmp'];

function isMountBlocked(destination) {
  return SYSTEM_MOUNT_PREFIXES.some(
    (prefix) => destination === prefix || destination.startsWith(prefix + '/'),
  );
}

function renderContainers() {
  elements.containerCount.textContent = String(state.containers.length);

  const eligible = state.containers.filter((container) => container.state !== 'created');

  if (!eligible.length) {
    elements.containerOptions.innerHTML = '<p class="empty-state">Nenhum container encontrado.</p>';
    return;
  }

  const selected = new Set(getSelectedContainerIds());
  elements.containerOptions.innerHTML = eligible.map((container) => {
    const hasVolumeSelection = Boolean(state.volumeSelections[container.id]?.length);
    return `
    <label class="container-option">
      <input type="checkbox" name="containerIds" value="${escapeHtml(container.id)}" ${selected.has(container.id) ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(container.name)}</strong>
        <small>${escapeHtml(container.image)} · ${escapeHtml(container.status)}${hasVolumeSelection ? ` · ${state.volumeSelections[container.id].length} volume(s) selecionado(s)` : ''}</small>
      </span>
      <em class="state ${escapeHtml(container.state)}">${escapeHtml(container.state)}</em>
    </label>
  `;
  }).join('');
}

function backupButtons(profile) {
  const isRunning = state.activeRuns.has(profile.id);
  return `
    <div class="run-actions">
      <label class="mode-picker" for="runMode-${escapeHtml(profile.id)}">
        <span>Modo do backup</span>
        <select id="runMode-${escapeHtml(profile.id)}" data-run-mode="${escapeHtml(profile.id)}" class="mode-select" ${isRunning ? 'disabled' : ''}>
          <option value="full">Full</option>
          <option value="incremental">Incremental</option>
        </select>
      </label>
      <div class="card-actions">
        <button data-action="run" data-profile-id="${escapeHtml(profile.id)}" class="primary-button small" ${isRunning ? 'disabled' : ''}>${isRunning ? 'Executando...' : 'Run'}</button>
        <button data-action="edit" data-profile-id="${escapeHtml(profile.id)}" class="secondary-button small">Editar</button>
        <button data-action="delete" data-profile-id="${escapeHtml(profile.id)}" class="ghost-button small">Excluir</button>
      </div>
    </div>
  `;
}

function getRunMode(profileId) {
  const selector = document.querySelector(`select[data-run-mode="${profileId}"]`);
  const value = selector?.value;
  return value === 'incremental' ? 'incremental' : 'full';
}

function getProfileScopeLabel(scope) {
  return scope === 'container' ? 'container inteiro' : 'somente volumes';
}

async function askVolumeSelection(containerId, containerName, currentSelections) {
  let mounts;
  try {
    mounts = await api(`/api/containers/${encodeURIComponent(containerId)}/mounts`);
  } catch (error) {
    showToast(`Falha ao buscar volumes de ${containerName}: ${error.message}`, true);
    return null;
  }

  if (!mounts.length) {
    showToast(`Container ${containerName} não possui volumes.`, true);
    return null;
  }

  const hasEligible = mounts.some((m) => !isMountBlocked(m.destination));
  if (!hasEligible) {
    showToast(`Container ${containerName} não possui volumes elegíveis (todos são caminhos de sistema).`, true);
    return null;
  }

  elements.volumePickerSubtitle.textContent = `Container: ${containerName}`;
  elements.volumePickerOptions.innerHTML = mounts.map((mount) => {
    const blocked = isMountBlocked(mount.destination);
    const isChecked = currentSelections
      ? currentSelections.includes(mount.destination)
      : !blocked;
    return `
      <label class="modal-option${blocked ? ' volume-blocked' : ''}">
        <input
          type="checkbox"
          name="volumePaths"
          value="${escapeHtml(mount.destination)}"
          ${isChecked && !blocked ? 'checked' : ''}
          ${blocked ? 'disabled' : ''}
        />
        <span>
          <strong>${escapeHtml(mount.destination)}</strong>
          <small>${escapeHtml(mount.type)} · ${escapeHtml(mount.source || mount.name || '')}${blocked ? ' · sistema (bloqueado)' : ''}</small>
        </span>
      </label>
    `;
  }).join('');

  elements.volumePickerModal.classList.remove('hidden');
  elements.volumePickerModal.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const closeModal = () => {
      elements.volumePickerModal.classList.add('hidden');
      elements.volumePickerModal.setAttribute('aria-hidden', 'true');
      elements.volumePickerOptions.innerHTML = '';
    };

    const cleanup = () => {
      elements.volumePickerConfirm.removeEventListener('click', onConfirm);
      elements.volumePickerClose.removeEventListener('click', onCancel);
      elements.volumePickerSelectAll.removeEventListener('click', onSelectAll);
      elements.volumePickerModal.removeEventListener('click', onBackdropClick);
    };

    const onConfirm = () => {
      const selected = [...elements.volumePickerOptions.querySelectorAll('input[name="volumePaths"]:checked')]
        .map((input) => input.value);
      if (!selected.length) {
        showToast('Selecione ao menos um volume.', true);
        return;
      }
      cleanup();
      closeModal();
      resolve(selected);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };

    const onSelectAll = () => {
      for (const input of elements.volumePickerOptions.querySelectorAll('input[name="volumePaths"]:not([disabled])')) {
        input.checked = true;
      }
    };

    const onBackdropClick = (event) => {
      if (event.target.closest('[data-action="close-volume-picker"]')) {
        onCancel();
      }
    };

    elements.volumePickerConfirm.addEventListener('click', onConfirm);
    elements.volumePickerClose.addEventListener('click', onCancel);
    elements.volumePickerSelectAll.addEventListener('click', onSelectAll);
    elements.volumePickerModal.addEventListener('click', onBackdropClick);
  });
}

async function handleContainerCheck(event) {
  const input = event.target.closest('input[name="containerIds"]');
  if (!input) {
    return;
  }

  const scope = document.querySelector('input[name="backupScope"]:checked')?.value;
  if (scope !== 'volumes') {
    return;
  }

  const containerId = input.value;
  const label = input.closest('label');
  const containerName = label?.querySelector('strong')?.textContent || containerId.slice(0, 12);

  if (!input.checked) {
    delete state.volumeSelections[containerId];
    renderContainers();
    input.checked = false;
    return;
  }

  const currentSelections = state.volumeSelections[containerId] || null;
  const selected = await askVolumeSelection(containerId, containerName, currentSelections);

  if (selected === null) {
    input.checked = false;
    return;
  }

  state.volumeSelections[containerId] = selected;
  renderContainers();
  const updatedInput = document.querySelector(`input[name="containerIds"][value="${CSS.escape(containerId)}"]`);
  if (updatedInput) {
    updatedInput.checked = true;
  }
}

function askRestoreContainerSelection(profile, backup) {
  const restorable = (backup.containers || []).filter((item) => item.status === 'ok');
  if (!restorable.length) {
    throw new Error('Nao ha containers validos neste backup para restaurar.');
  }

  elements.restoreModalSubtitle.textContent = `${profile.name} - ${new Date(backup.createdAt).toLocaleString('pt-BR')}`;
  elements.restoreContainerOptions.innerHTML = restorable.map((item) => `
    <label class="modal-option">
      <input type="checkbox" name="restoreContainerIds" value="${escapeHtml(item.containerId)}" checked />
      <span>
        <strong>${escapeHtml(item.containerName)}</strong>
        <small>${escapeHtml(item.status)}</small>
      </span>
    </label>
  `).join('');

  elements.restoreModal.classList.remove('hidden');
  elements.restoreModal.setAttribute('aria-hidden', 'false');

  return new Promise((resolve, reject) => {
    const closeModal = () => {
      elements.restoreModal.classList.add('hidden');
      elements.restoreModal.setAttribute('aria-hidden', 'true');
      elements.restoreContainerOptions.innerHTML = '';
    };

    const cleanup = () => {
      elements.restoreModalConfirm.removeEventListener('click', onConfirm);
      elements.restoreModalClose.removeEventListener('click', onCancel);
      elements.restoreModalSelectAll.removeEventListener('click', onSelectAll);
      elements.restoreModal.removeEventListener('click', onBackdropClick);
    };

    const onConfirm = () => {
      const selected = [...elements.restoreContainerOptions.querySelectorAll('input[name="restoreContainerIds"]:checked')]
        .map((input) => input.value);

      if (!selected.length) {
        showToast('Selecione ao menos um container para restaurar.', true);
        return;
      }

      cleanup();
      closeModal();
      resolve(selected);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };

    const onSelectAll = () => {
      for (const input of elements.restoreContainerOptions.querySelectorAll('input[name="restoreContainerIds"]')) {
        input.checked = true;
      }
    };

    const onBackdropClick = (event) => {
      const closeTrigger = event.target.closest('[data-action="close-restore-modal"]');
      if (closeTrigger) {
        onCancel();
      }
    };

    elements.restoreModalConfirm.addEventListener('click', onConfirm);
    elements.restoreModalClose.addEventListener('click', onCancel);
    elements.restoreModalSelectAll.addEventListener('click', onSelectAll);
    elements.restoreModal.addEventListener('click', onBackdropClick);
  });
}

function formatBackupFailures(backup) {
  const failures = (backup.containers || []).filter((item) => item.status === 'error');
  if (!failures.length) {
    return '';
  }

  return `
    <small class="backup-error">
      Falhas: ${failures.map((item) => `${escapeHtml(item.containerName || item.containerId || 'container')}: ${escapeHtml(item.error || 'erro desconhecido')}`).join(' | ')}
    </small>
  `;
}

function progressBar(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${normalized}">
      <span class="progress-fill" style="width: ${normalized}%;"></span>
    </div>
  `;
}

function renderRunProgress(profileId) {
  const run = state.activeRuns.get(profileId);
  const host = document.querySelector(`[data-run-progress="${profileId}"]`);
  if (!host) {
    return;
  }

  if (!run || !run.progress) {
    host.innerHTML = '';
    host.classList.add('hidden');
    return;
  }

  const overall = run.progress.overall || { total: 0, completed: 0, pending: 0, percent: 0 };
  const currentContainer = run.progress.currentContainer;
  const file = currentContainer?.file || { current: 0, total: 0, percent: 0, currentFile: null };
  const containerPercent = Number.isFinite(currentContainer?.percent) ? currentContainer.percent : 0;
  const stepLabel = currentContainer?.step || 'aguardando';
  const stepMessage = currentContainer?.message || 'Aguardando processamento de arquivo...';
  const logs = Array.isArray(currentContainer?.logs) ? currentContainer.logs.slice(-8) : [];
  const operation = run?.kind === 'restore' || run?.progress?.operation === 'restore' ? 'restore' : 'backup';
  const operationTitle = operation === 'restore' ? 'Progresso do restore' : 'Progresso do backup';

  host.classList.remove('hidden');
  host.innerHTML = `
    <div class="progress-card">
      <div class="progress-header">
        <strong>${escapeHtml(operationTitle)}</strong>
        <small>${escapeHtml(run.status)}</small>
      </div>

      <div class="progress-block">
        <div class="progress-label-row">
          <span>Containers: ${escapeHtml(String(overall.completed))}/${escapeHtml(String(overall.total))} concluido(s)</span>
          <span>Faltam ${escapeHtml(String(overall.pending))}</span>
        </div>
        ${progressBar(overall.percent)}
      </div>

      <div class="progress-block">
        <div class="progress-label-row">
          <span>Container atual: ${escapeHtml(currentContainer?.containerName || currentContainer?.containerId || '-')}</span>
          <span>${escapeHtml(String(Math.round(containerPercent)))}%</span>
        </div>
        ${progressBar(containerPercent)}
      </div>

      <div class="progress-block">
        <div class="progress-label-row">
          <span>Arquivos: ${escapeHtml(String(file.current || 0))}/${escapeHtml(String(file.total || 0))}</span>
          <span>${escapeHtml(String(Math.round(file.percent || 0)))}%</span>
        </div>
        ${progressBar(file.percent || 0)}
        <small class="current-file">Etapa: ${escapeHtml(stepLabel)} · ${escapeHtml(file.currentFile || stepMessage)}</small>
      </div>

      <div class="progress-block">
        <div class="progress-label-row">
          <span>Log detalhado</span>
          <span>${escapeHtml(String(logs.length))} evento(s)</span>
        </div>
        <div class="progress-log">
          ${logs.length
    ? logs.map((line) => `<small>${escapeHtml(line)}</small>`).join('')
    : '<small>Nenhum evento detalhado ainda.</small>'}
        </div>
      </div>
    </div>
  `;
}

function renderAllRunProgress() {
  for (const profile of state.profiles) {
    renderRunProgress(profile.id);
  }
}

async function pollRun(profileId, runId) {
  const doneStatus = new Set(['completed', 'completed-with-errors', 'error']);

  while (true) {
    const run = await api(`/api/runs/${runId}`);
    state.activeRuns.set(profileId, run);
    renderRunProgress(profileId);

    if (doneStatus.has(run.status)) {
      return run;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 700);
    });
  }
}

function restoreButtons(profile, backups) {
  if (!backups.length) {
    return '<p class="empty-inline">Nenhum backup executado ainda.</p>';
  }

  return `
    <div class="backup-history">
      ${backups.map((backup) => `
        <button
          class="backup-item"
          data-action="restore"
          data-profile-id="${escapeHtml(profile.id)}"
          data-backup-id="${escapeHtml(backup.id)}"
        >
          <span>
            <strong>${escapeHtml(new Date(backup.createdAt).toLocaleString('pt-BR'))}</strong>
            <small>${escapeHtml(backup.mode)} · ${escapeHtml(getProfileScopeLabel(backup.backupScope))} · ${escapeHtml(backup.status)} · ${escapeHtml(backup.containers.map((item) => item.containerName).join(', '))}</small>
            ${formatBackupFailures(backup)}
          </span>
          <em>Restore</em>
        </button>
      `).join('')}
    </div>
  `;
}

async function renderProfiles() {
  elements.profileCount.textContent = String(state.profiles.length);

  if (!state.profiles.length) {
    elements.profilesList.innerHTML = '<p class="empty-state">Nenhum profile salvo.</p>';
    return;
  }

  const backupsByProfile = await Promise.all(
    state.profiles.map(async (profile) => [profile.id, await api(`/api/profiles/${profile.id}/backups`)])
  );
  const backupMap = new Map(backupsByProfile);

  elements.profilesList.innerHTML = state.profiles.map((profile) => `
    <article class="profile-card">
      <div class="profile-card-top">
        <div>
          <h3>${escapeHtml(profile.name)}</h3>
          <p>${escapeHtml(String(profile.containerIds.length))} container(es) · ${escapeHtml(getProfileScopeLabel(profile.backupScope))}</p>
          <code>${escapeHtml(profile.backupDir)}</code>
        </div>
        ${backupButtons(profile)}
      </div>
      <div class="chips">
        ${profile.containerIds.map((containerId) => {
          const container = state.containers.find((item) => item.id === containerId);
          return `<span class="chip">${escapeHtml(container ? container.name : containerId.slice(0, 12))}</span>`;
        }).join('')}
      </div>
      <div class="run-progress hidden" data-run-progress="${escapeHtml(profile.id)}"></div>
      <div class="restore-block">
        <h4>Restaurar</h4>
        ${restoreButtons(profile, backupMap.get(profile.id) || [])}
      </div>
    </article>
  `).join('');

  renderAllRunProgress();
}

function resetForm() {
  elements.profileForm.reset();
  elements.profileId.value = '';
  state.volumeSelections = {};
  renderContainers();
  closeProfileModal();
}

function fillForm(profile) {
  elements.profileId.value = profile.id;
  elements.profileName.value = profile.name;
  elements.backupDir.value = profile.backupDir;
  const backupScope = profile.backupScope === 'container' ? 'container' : 'volumes';
  document.querySelector(`input[name="backupScope"][value="${backupScope}"]`).checked = true;
  state.volumeSelections = Object.assign({}, profile.volumeSelections || {});
  renderContainers();
  for (const containerId of profile.containerIds) {
    const input = document.querySelector(`input[name="containerIds"][value="${containerId}"]`);
    if (input) {
      input.checked = true;
    }
  }
  openProfileModal('Editar Profile');
}

async function loadContainers() {
  state.containers = await api('/api/containers');
  renderContainers();
}

async function loadProfiles() {
  state.profiles = await api('/api/profiles');
  await renderProfiles();
}

async function saveProfile(event) {
  event.preventDefault();
  const selectedContainerIds = getSelectedContainerIds();
  const backupScope = document.querySelector('input[name="backupScope"]:checked').value;

  const volumeSelections = {};
  if (backupScope === 'volumes') {
    for (const id of selectedContainerIds) {
      if (state.volumeSelections[id]?.length) {
        volumeSelections[id] = state.volumeSelections[id];
      }
    }
  }

  const payload = {
    id: elements.profileId.value || undefined,
    name: elements.profileName.value,
    backupDir: elements.backupDir.value,
    containerIds: selectedContainerIds,
    backupScope,
    volumeSelections,
  };

  try {
    await api('/api/profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    closeProfileModal();
    await loadProfiles();
    resetForm();
    showToast('Profile salvo.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleProfileAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { action, profileId, backupId } = button.dataset;
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) {
    return;
  }

  try {
    if (action === 'edit') {
      fillForm(profile);
      return;
    }

    if (action === 'delete') {
      if (!window.confirm(`Excluir o profile ${profile.name}?`)) {
        return;
      }
      await api(`/api/profiles/${profileId}`, { method: 'DELETE' });
      await loadProfiles();
      showToast('Profile removido.');
      return;
    }

    if (action === 'run') {
      button.disabled = true;
      button.textContent = 'Executando...';
      const mode = getRunMode(profileId);

      const start = await api(`/api/profiles/${profileId}/run`, { method: 'POST', body: JSON.stringify({ mode }) });
      state.activeRuns.set(profileId, {
        id: start.runId,
        profileId,
        status: 'running',
        progress: {
          overall: { total: profile.containerIds.length, completed: 0, pending: profile.containerIds.length, percent: 0 },
          currentContainer: null,
        },
      });
      renderRunProgress(profileId);

      const run = await pollRun(profileId, start.runId);
      state.activeRuns.delete(profileId);
      await loadProfiles();
      if (run.status === 'error') {
        showToast(run.error || 'Falha durante a execucao do backup.', true);
      } else {
        const backupStatus = run.result?.status;
        const failures = (run.result?.containers || []).filter((item) => item.status === 'error');
        if (failures.length) {
          const details = failures
            .map((item) => `${item.containerName || item.containerId || 'container'}: ${item.error || 'erro desconhecido'}`)
            .join(' | ');
          showToast(`Backup com falhas. ${details}`, true);
        } else {
          showToast(
            backupStatus === 'ok' ? 'Backup concluido.' : 'Backup concluido com falhas parciais.',
            backupStatus !== 'ok',
          );
        }
      }
      return;
    }

    if (action === 'restore') {
      if (!window.confirm(`Restaurar o backup selecionado para o profile ${profile.name}?`)) {
        return;
      }

      const backups = await api(`/api/profiles/${profileId}/backups`);
      const selectedBackup = backups.find((item) => item.id === backupId);
      if (!selectedBackup) {
        throw new Error('Backup selecionado nao encontrado.');
      }

      const selectedContainerIds = await askRestoreContainerSelection(profile, selectedBackup);
      if (!selectedContainerIds) {
        return;
      }

      button.disabled = true;
      button.textContent = 'Restaurando...';

      const start = await api(`/api/profiles/${profileId}/restore`, {
        method: 'POST',
        body: JSON.stringify({ backupId, containerIds: selectedContainerIds }),
      });
      state.activeRuns.set(profileId, {
        id: start.runId,
        kind: 'restore',
        profileId,
        status: 'running',
        progress: {
          operation: 'restore',
          overall: {
            total: selectedContainerIds.length,
            completed: 0,
            pending: selectedContainerIds.length,
            percent: 0,
          },
          currentContainer: null,
        },
      });
      renderRunProgress(profileId);

      const run = await pollRun(profileId, start.runId);
      state.activeRuns.delete(profileId);
      await loadProfiles();

      if (run.status === 'error') {
        showToast(run.error || 'Falha durante a execucao do restore.', true);
      } else {
        const restoreStatus = run.result?.status;
        const restoreStatsLines = (run.result?.containers || [])
          .filter((item) => item.status === 'ok' && item.stats)
          .map((item) => `${item.containerName}: apagados ${item.stats.deleted}, criados ${item.stats.created}, modificados ${item.stats.modified}`);

        const failures = (run.result?.containers || []).filter((item) => item.status === 'error');
        if (failures.length) {
          const details = failures
            .map((item) => `${item.containerName || item.containerId || 'container'}: ${item.error || 'erro desconhecido'}`)
            .join(' | ');
          const statsSummary = restoreStatsLines.length ? ` ${restoreStatsLines.join(' | ')}` : '';
          showToast(`Restore com falhas. ${details}.${statsSummary}`, true);
        } else {
          const summary = restoreStatsLines.length ? ` ${restoreStatsLines.join(' | ')}` : '';
          showToast(
            `${restoreStatus === 'ok' ? 'Restore concluido.' : 'Restore concluido com falhas parciais.'}${summary}`,
            restoreStatus !== 'ok',
          );
        }
      }
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  try {
    await Promise.all([loadContainers(), loadProfiles()]);
    await updateDashboard();
  } catch (error) {
    showToast(error.message, true);
  }
}

elements.profileForm.addEventListener('submit', saveProfile);
elements.containerOptions.addEventListener('change', handleContainerCheck);
document.querySelector('#refreshContainers').addEventListener('click', init);
document.querySelector('#reloadProfiles').addEventListener('click', loadProfiles);
document.querySelector('#clearForm').addEventListener('click', resetForm);
elements.profilesList.addEventListener('click', handleProfileAction);
document.querySelector('#backupsViewList').addEventListener('click', handleProfileAction);
document.querySelector('#refreshRuns')?.addEventListener('click', () => loadAllRuns());

init();