// ─── i18n ─────────────────────────────────────────────────
const TRANSLATIONS = window.TRANSLATIONS || {};
const LOCALE_NAMES = window.LOCALE_NAMES || {};

let currentLang = localStorage.getItem('lang') || 'pt-BR';

function t(key) {
  return (TRANSLATIONS[currentLang] || TRANSLATIONS['pt-BR'] || {})[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
}

// ─── Themes ───────────────────────────────────────────────
const VALID_THEMES = new Set([
  'default','dark','sunrise','forest','ocean','purple','rose','orange','graphite','sapphire','contrast'
]);

function applyTheme(theme) {
  const safe = VALID_THEMES.has(theme) ? theme : 'default';
  if (safe === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', safe);
  }
  localStorage.setItem('theme', safe);
  const sel = document.querySelector('#settingsTheme');
  if (sel) sel.value = safe;
}

// Apply saved theme immediately
applyTheme(localStorage.getItem('theme') || 'default');

document.addEventListener('change', (e) => {
  if (e.target.id === 'settingsTheme') applyTheme(e.target.value);
});

// ─── Auth ──────────────────────────────────────────────────
let authToken = localStorage.getItem('authToken') || null;

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['x-auth-token'] = authToken;
  }
  return headers;
}

const state = {
  containers: [],
  profiles: [],
  storageLocations: [],
  schedules: [],
  sources: [],
  activeRuns: new Map(),
  volumeSelections: {},
};

const elements = {
  containerCount: document.querySelector('#containerCount'),
  profileCount: document.querySelector('#profileCount'),
  profileForm: document.querySelector('#profileForm'),
  profileId: document.querySelector('#profileId'),
  profileName: document.querySelector('#profileName'),
  storageLocationSelect: document.querySelector('#storageLocationId'),
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
  fullBackupPickerModal: document.querySelector('#fullBackupPickerModal'),
  fullBackupPickerOptions: document.querySelector('#fullBackupPickerOptions'),
  fullBackupPickerConfirm: document.querySelector('#fullBackupPickerConfirm'),
  fullBackupPickerClose: document.querySelector('#fullBackupPickerClose'),
  storageLocationFormModal: document.querySelector('#storageLocationFormModal'),
  storageLocationForm: document.querySelector('#storageLocationForm'),
  storageLocationName: document.querySelector('#storageLocationName'),
  storageLocationDir: document.querySelector('#storageLocationDir'),
  storageLocationIdField: document.querySelector('#storageFormId'),
  storageLocationsList: document.querySelector('#storageLocationsList'),
  // storage type fields
  storageHost: document.querySelector('#storageHost'),
  storagePort: document.querySelector('#storagePort'),
  storageUsername: document.querySelector('#storageUsername'),
  storagePassword: document.querySelector('#storagePassword'),
  storageRemotePath: document.querySelector('#storageRemotePath'),
  storagePassive: document.querySelector('#storagePassive'),
  storagePrivateKey: document.querySelector('#storagePrivateKey'),
  storageWebdavUrl: document.querySelector('#storageWebdavUrl'),
  storageWebdavUsername: document.querySelector('#storageWebdavUsername'),
  storageWebdavPassword: document.querySelector('#storageWebdavPassword'),
  storageWebdavRemotePath: document.querySelector('#storageWebdavRemotePath'),
  storageGdriveClientId: document.querySelector('#storageGdriveClientId'),
  storageGdriveClientSecret: document.querySelector('#storageGdriveClientSecret'),
  storageGdriveRefreshToken: document.querySelector('#storageGdriveRefreshToken'),
  storageGdriveFolderId: document.querySelector('#storageGdriveFolderId'),
  sourceFormModal: document.querySelector('#sourceFormModal'),
  sourceForm: document.querySelector('#sourceForm'),
  sourceFormId: document.querySelector('#sourceFormId'),
  sourceFormName: document.querySelector('#sourceFormName'),
  sourceFormHost: document.querySelector('#sourceFormHost'),
  sourceFormPort: document.querySelector('#sourceFormPort'),
  sourcesList: document.querySelector('#sourcesList'),
  profileSourceSelect: document.querySelector('#profileSourceId'),
  // snapshot modal
  snapshotModal: document.querySelector('#snapshotModal'),
  snapshotModalSubtitle: document.querySelector('#snapshotModalSubtitle'),
  snapshotContainerTabs: document.querySelector('#snapshotContainerTabs'),
  snapshotSearch: document.querySelector('#snapshotSearch'),
  snapshotStats: document.querySelector('#snapshotStats'),
  snapshotLoading: document.querySelector('#snapshotLoading'),
  snapshotFileList: document.querySelector('#snapshotFileList'),
  snapshotSelectAll: document.querySelector('#snapshotSelectAll'),
  snapshotExtract: document.querySelector('#snapshotExtract'),
  snapshotModalClose: document.querySelector('#snapshotModalClose'),
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
  if (viewName === 'runs') {
    loadAllRuns();
  }
  if (viewName === 'backups') {
    renderBackupsView();
  }
  if (viewName === 'schedules') {
    loadSchedules();
  }
  if (viewName === 'storage') {
    loadStorageLocations();
  }
  if (viewName === 'source') {
    loadSources();
  }
  if (viewName === 'settings') {
    loadSettingsView();
  }
  if (viewName === 'about') {
    loadAboutView();
  }
}

document.querySelector('.sidebar').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item[data-view]');
  if (btn) {
    navigateTo(btn.dataset.view);
  }
});

document.querySelector('#createProfileBtn')?.addEventListener('click', () => navigateTo('profiles'));

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
  populateStorageLocationDropdown();
  populateSourceDropdown();
  openProfileModal('Novo Profile');
});

elements.profileModalClose?.addEventListener('click', closeProfileModal);

elements.profileFormModal?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-profile-modal"]')) {
    closeProfileModal();
  }
});

// ─── Storage Locations ────────────────────────────────────
async function loadStorageLocations() {
  state.storageLocations = await api('/api/storage-locations');
  renderStorageLocationsList();
  populateStorageLocationDropdown();
}

function renderStorageLocationsList() {
  const list = elements.storageLocationsList;
  if (!list) return;

  if (!state.storageLocations.length) {
    list.innerHTML = '<p class="empty-state">Nenhum local de armazenamento configurado. Crie um para poder configurar backup profiles.</p>';
    return;
  }

  const STORAGE_TYPE_LABELS = {
    'local': 'Local',
    'ftp': 'FTP',
    'sftp': 'SFTP',
    'webdav': 'WebDAV',
    'google-drive': 'Google Drive',
  };

  function storageLocationSummary(loc) {
    const type = loc.type || 'local';
    if (type === 'local') return `<code>${escapeHtml(loc.directory || '')}</code>`;
    if (type === 'ftp' || type === 'sftp') {
      const host = loc.host ? escapeHtml(loc.host) : '—';
      const port = loc.port ? `:${loc.port}` : '';
      const path = loc.remotePath ? escapeHtml(loc.remotePath) : '';
      return `<code>${host}${port}${path ? '/' + path.replace(/^\//, '') : ''}</code>`;
    }
    if (type === 'webdav') return `<code>${escapeHtml(loc.url || '')}</code>`;
    if (type === 'google-drive') {
      return loc.folderId ? `<code>folder: ${escapeHtml(loc.folderId)}</code>` : '<code>Drive raiz</code>';
    }
    return '';
  }

  list.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Nome</th><th>Tipo</th><th>Destino</th><th>Ações</th></tr></thead>
      <tbody>
        ${state.storageLocations.map((loc) => `
          <tr>
            <td><strong>${escapeHtml(loc.name)}</strong></td>
            <td><span class="storage-type-badge">${escapeHtml(STORAGE_TYPE_LABELS[loc.type || 'local'] || loc.type || 'local')}</span></td>
            <td>${storageLocationSummary(loc)}</td>
            <td>
              <button class="btn btn--ghost btn--sm" data-storage-action="delete" data-storage-id="${escapeHtml(loc.id)}">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function populateStorageLocationDropdown() {
  const select = elements.storageLocationSelect;
  if (!select) return;
  const current = select.value;
  const STORAGE_TYPE_LABELS = { 'local': 'Local', 'ftp': 'FTP', 'sftp': 'SFTP', 'webdav': 'WebDAV', 'google-drive': 'Google Drive' };
  select.innerHTML = '<option value="">Selecione um local...</option>' +
    state.storageLocations.map((loc) => {
      const typeLabel = STORAGE_TYPE_LABELS[loc.type || 'local'] || loc.type || 'local';
      const detail = (loc.type === 'local' || !loc.type) ? (loc.directory || '') :
        (loc.host || loc.url || loc.clientId || '');
      return `<option value="${escapeHtml(loc.id)}">[${escapeHtml(typeLabel)}] ${escapeHtml(loc.name)}${detail ? ' — ' + escapeHtml(detail) : ''}</option>`;
    }).join('');
  if (current) select.value = current;
}

function updateStorageTypeFields(type) {
  const sections = {
    local: document.querySelector('#storageFieldsLocal'),
    ftpSftp: document.querySelector('#storageFieldsFtpSftp'),
    ftpOnly: document.querySelector('#storageFieldsFtpOnly'),
    sftpOnly: document.querySelector('#storageFieldsSftpOnly'),
    webdav: document.querySelector('#storageFieldsWebdav'),
    gdrive: document.querySelector('#storageFieldsGdrive'),
  };

  const show = (el) => el?.classList.remove('hidden');
  const hide = (el) => el?.classList.add('hidden');

  hide(sections.local);
  hide(sections.ftpSftp);
  hide(sections.ftpOnly);
  hide(sections.sftpOnly);
  hide(sections.webdav);
  hide(sections.gdrive);

  if (type === 'local') {
    show(sections.local);
    // Update port placeholder when switching to local doesn't apply
  } else if (type === 'ftp') {
    show(sections.ftpSftp);
    show(sections.ftpOnly);
    if (elements.storagePort && !elements.storagePort.value) elements.storagePort.placeholder = '21';
  } else if (type === 'sftp') {
    show(sections.ftpSftp);
    show(sections.sftpOnly);
    if (elements.storagePort && !elements.storagePort.value) elements.storagePort.placeholder = '22';
  } else if (type === 'webdav') {
    show(sections.webdav);
  } else if (type === 'google-drive') {
    show(sections.gdrive);
  }
}

function openStorageModal() {
  document.querySelector('#storageModalTitle').textContent = 'Novo Local de Armazenamento';
  elements.storageLocationForm.reset();
  elements.storageLocationIdField.value = '';
  // Reset to local type
  const localRadio = elements.storageLocationForm.querySelector('input[name="storageType"][value="local"]');
  if (localRadio) localRadio.checked = true;
  updateStorageTypeFields('local');
  elements.storageLocationFormModal.classList.remove('hidden');
  elements.storageLocationFormModal.setAttribute('aria-hidden', 'false');
}

function closeStorageModal() {
  elements.storageLocationFormModal.classList.add('hidden');
  elements.storageLocationFormModal.setAttribute('aria-hidden', 'true');
}

async function saveStorageLocation(event) {
  event.preventDefault();

  const form = elements.storageLocationForm;
  const selectedTypeInput = form.querySelector('input[name="storageType"]:checked');
  const type = selectedTypeInput ? selectedTypeInput.value : 'local';

  const payload = {
    id: elements.storageLocationIdField.value || undefined,
    name: elements.storageLocationName.value.trim(),
    type,
  };

  if (type === 'local') {
    payload.directory = elements.storageLocationDir.value.trim();
    if (!payload.directory) {
      showToast('Informe o diretório para armazenamento local.', true);
      return;
    }
  } else if (type === 'ftp' || type === 'sftp') {
    payload.host = elements.storageHost.value.trim();
    payload.port = elements.storagePort.value ? Number(elements.storagePort.value) : (type === 'ftp' ? 21 : 22);
    payload.username = elements.storageUsername.value.trim();
    payload.password = elements.storagePassword.value;
    payload.remotePath = elements.storageRemotePath.value.trim();
    if (!payload.host || !payload.username) {
      showToast('Informe host e usuário para ' + type.toUpperCase() + '.', true);
      return;
    }
    if (type === 'ftp') {
      payload.passive = elements.storagePassive.checked;
    } else {
      payload.privateKey = elements.storagePrivateKey.value;
    }
  } else if (type === 'webdav') {
    payload.url = elements.storageWebdavUrl.value.trim();
    payload.username = elements.storageWebdavUsername.value.trim();
    payload.password = elements.storageWebdavPassword.value;
    payload.remotePath = elements.storageWebdavRemotePath.value.trim();
    if (!payload.url) {
      showToast('Informe a URL do servidor WebDAV.', true);
      return;
    }
  } else if (type === 'google-drive') {
    payload.clientId = elements.storageGdriveClientId.value.trim();
    payload.clientSecret = elements.storageGdriveClientSecret.value;
    payload.refreshToken = elements.storageGdriveRefreshToken.value;
    payload.folderId = elements.storageGdriveFolderId.value.trim();
    if (!payload.clientId || !payload.clientSecret || !payload.refreshToken) {
      showToast('Informe Client ID, Client Secret e Refresh Token para Google Drive.', true);
      return;
    }
  }

  try {
    await api('/api/storage-locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    closeStorageModal();
    await loadStorageLocations();
    showToast('Local de armazenamento salvo.');
  } catch (error) {
    showToast(error.message, true);
  }
}

document.querySelector('#openCreateStorageModal')?.addEventListener('click', openStorageModal);
document.querySelector('#cancelStorageForm')?.addEventListener('click', closeStorageModal);
document.querySelector('#storageModalClose')?.addEventListener('click', closeStorageModal);
elements.storageLocationFormModal?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-storage-modal"]')) closeStorageModal();
});
elements.storageLocationFormModal?.addEventListener('change', (e) => {
  if (e.target.name === 'storageType') updateStorageTypeFields(e.target.value);
});
elements.storageLocationForm?.addEventListener('submit', saveStorageLocation);
elements.storageLocationsList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-storage-action="delete"]');
  if (!btn) return;
  const id = btn.dataset.storageId;

  // Fetch impact before confirming
  let impact = { profileCount: 0, profileNames: [], backupCount: 0 };
  try {
    impact = await api(`/api/storage-locations/${id}/impact`);
  } catch {
    // Non-fatal; proceed with generic message
  }

  let message = 'Excluir este local de armazenamento?';
  if (impact.profileCount > 0) {
    const names = impact.profileNames.map((n) => `• ${n}`).join('\n');
    message =
      `⚠️ ATENÇÃO: Esta ação também irá excluir permanentemente:\n\n` +
      `  ${impact.profileCount} profile(s) de backup:\n${names}\n\n` +
      `  ${impact.backupCount} backup(s) registrado(s) desses profiles\n\n` +
      `Deseja continuar?`;
  }

  if (!window.confirm(message)) return;
  try {
    await api(`/api/storage-locations/${id}`, { method: 'DELETE' });
    await Promise.all([loadStorageLocations(), loadProfiles()]);
    showToast(impact.profileCount > 0
      ? `Local removido junto com ${impact.profileCount} profile(s) e ${impact.backupCount} backup(s).`
      : 'Local de armazenamento removido.');
  } catch (error) {
    showToast(error.message, true);
  }
});

// ─── Sources ──────────────────────────────────────────────
const SOURCE_TYPE_LABELS = {
  'unix-socket': 'Unix Socket',
  'direct': 'Direto (TCP)',
  'agent': 'Docker Agent',
};

let _unixSocketAvailable = false;

async function checkUnixSocket() {
  try {
    const result = await api('/api/sources/check-unix-socket');
    _unixSocketAvailable = result.available === true;
  } catch {
    _unixSocketAvailable = false;
  }
  const card = document.querySelector('#unixSocketRadioCard');
  const msg = document.querySelector('#unixSocketUnavailableMsg');
  const radio = document.querySelector('#sourceTypeUnixSocket');
  if (card) card.style.opacity = _unixSocketAvailable ? '' : '0.45';
  if (radio) radio.disabled = !_unixSocketAvailable;
  if (msg) msg.classList.toggle('hidden', _unixSocketAvailable);
}

async function loadSources() {
  try {
    state.sources = await api('/api/sources');
    renderSourcesList();
    populateSourceDropdown();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderSourcesList() {
  const list = elements.sourcesList;
  if (!list) return;

  if (!state.sources.length) {
    list.innerHTML = '<p class="empty-state" data-i18n="source.empty">Nenhuma origem configurada. Crie uma para poder conectar a diferentes hosts Docker.</p>';
    applyTranslations();
    return;
  }

  list.innerHTML = `
    <table class="data-table">
      <thead><tr><th data-i18n="source.name">Nome</th><th data-i18n="source.type">Tipo</th><th>Conexão</th><th>Ações</th></tr></thead>
      <tbody>
        ${state.sources.map((src) => {
          const connInfo = src.type === 'unix-socket'
            ? (src.socketPath || '/var/run/docker.sock')
            : `${src.host || '—'}:${src.port || 2375}`;
          return `
            <tr>
              <td><strong>${escapeHtml(src.name)}</strong></td>
              <td>${escapeHtml(SOURCE_TYPE_LABELS[src.type] || src.type)}</td>
              <td><code>${escapeHtml(connInfo)}</code></td>
              <td>
                <button class="btn btn--ghost btn--sm" data-source-action="delete" data-source-id="${escapeHtml(src.id)}">Excluir</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  applyTranslations();
}

function populateSourceDropdown() {
  const select = elements.profileSourceSelect;
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Padrão (socket local)</option>` +
    state.sources.map((src) =>
      `<option value="${escapeHtml(src.id)}">${escapeHtml(src.name)} — ${escapeHtml(SOURCE_TYPE_LABELS[src.type] || src.type)}</option>`
    ).join('');
  if (current) select.value = current;
}

function openSourceModal() {
  document.querySelector('#sourceModalTitle').textContent = 'Nova Origem';
  elements.sourceForm?.reset();
  if (elements.sourceFormId) elements.sourceFormId.value = '';
  // Default to 'direct' type
  const directRadio = document.querySelector('#sourceTypeDirect');
  if (directRadio) directRadio.checked = true;
  updateSourceTypeFields('direct');
  elements.sourceFormModal?.classList.remove('hidden');
  elements.sourceFormModal?.setAttribute('aria-hidden', 'false');
  checkUnixSocket();
}

function closeSourceModal() {
  elements.sourceFormModal?.classList.add('hidden');
  elements.sourceFormModal?.setAttribute('aria-hidden', 'true');
}

function updateSourceTypeFields(type) {
  const hostFields = document.querySelector('#sourceHostFields');
  if (!hostFields) return;
  if (type === 'unix-socket') {
    hostFields.classList.add('hidden');
  } else {
    hostFields.classList.remove('hidden');
    const portInput = elements.sourceFormPort;
    if (portInput && !portInput.value) {
      portInput.value = type === 'agent' ? '9000' : '2375';
    }
  }
}

async function saveSource(event) {
  event.preventDefault();
  const type = document.querySelector('input[name="sourceType"]:checked')?.value;
  if (!type) {
    showToast('Selecione o tipo de origem.', true);
    return;
  }

  const payload = {
    id: elements.sourceFormId?.value || undefined,
    name: elements.sourceFormName?.value.trim(),
    type,
    host: type !== 'unix-socket' ? elements.sourceFormHost?.value.trim() : undefined,
    port: type !== 'unix-socket' ? (Number(elements.sourceFormPort?.value) || null) : undefined,
    socketPath: type === 'unix-socket' ? '/var/run/docker.sock' : undefined,
  };

  try {
    await api('/api/sources', { method: 'POST', body: JSON.stringify(payload) });
    closeSourceModal();
    await loadSources();
    showToast(t('source.saved'));
  } catch (error) {
    showToast(error.message, true);
  }
}

document.querySelector('#openCreateSourceModal')?.addEventListener('click', openSourceModal);
document.querySelector('#cancelSourceForm')?.addEventListener('click', closeSourceModal);
document.querySelector('#sourceModalClose')?.addEventListener('click', closeSourceModal);
elements.sourceFormModal?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-source-modal"]')) closeSourceModal();
});
elements.sourceForm?.addEventListener('submit', saveSource);

document.querySelectorAll('input[name="sourceType"]').forEach((radio) => {
  radio.addEventListener('change', (e) => updateSourceTypeFields(e.target.value));
});

elements.sourcesList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-source-action="delete"]');
  if (!btn) return;
  const id = btn.dataset.sourceId;

  let impact = { profileCount: 0, profileNames: [], backupCount: 0 };
  try {
    impact = await api(`/api/sources/${id}/impact`);
  } catch {
    // Non-fatal
  }

  let message = t('source.confirmDelete');
  if (impact.profileCount > 0) {
    const names = impact.profileNames.map((n) => `• ${n}`).join('\n');
    message =
      `⚠️ ATENÇÃO: Esta ação também irá excluir permanentemente:\n\n` +
      `  ${impact.profileCount} profile(s) de backup:\n${names}\n\n` +
      `  ${impact.backupCount} backup(s) registrado(s) desses profiles\n\n` +
      `Deseja continuar?`;
  }

  if (!window.confirm(message)) return;
  try {
    await api(`/api/sources/${id}`, { method: 'DELETE' });
    await Promise.all([loadSources(), loadProfiles()]);
    showToast(impact.profileCount > 0
      ? `Origem removida junto com ${impact.profileCount} profile(s) e ${impact.backupCount} backup(s).`
      : t('source.deleted'));
  } catch (error) {
    showToast(error.message, true);
  }
});

// When source changes in profile form, reload containers for that source
elements.profileSourceSelect?.addEventListener('change', async () => {
  const sourceId = elements.profileSourceSelect.value || null;
  const url = sourceId ? `/api/containers?sourceId=${encodeURIComponent(sourceId)}` : '/api/containers';
  try {
    state.containers = await api(url);
    renderContainers();
  } catch {
    // Non-fatal
  }
});

// ─── Directory Browser Modal ──────────────────────────────let _dirBrowserCurrentPath = '/';

function openDirBrowser() {
  const initial = elements.storageLocationDir.value.trim() || '/';
  _dirBrowserCurrentPath = initial;
  const modal = document.querySelector('#dirBrowserModal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  loadDirBrowserPath(initial);
}

function closeDirBrowser() {
  const modal = document.querySelector('#dirBrowserModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function loadDirBrowserPath(dirPath) {
  _dirBrowserCurrentPath = dirPath;
  document.querySelector('#dirBrowserCurrent').textContent = dirPath;
  const list = document.querySelector('#dirBrowserList');
  list.innerHTML = '<div class="dir-browser-empty">Carregando…</div>';

  let data;
  try {
    data = await api(`/api/browse-dirs?path=${encodeURIComponent(dirPath)}`);
  } catch (err) {
    list.innerHTML = `<div class="dir-browser-empty">${escapeHtml(err.message)}</div>`;
    return;
  }

  const folderSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const upSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>`;

  let html = '';
  if (data.parent !== null) {
    html += `<div class="dir-browser-item dir-browser-item--up" data-dir-path="${escapeHtml(data.parent)}">${upSvg}<span>.. (subir)</span></div>`;
  }
  if (data.dirs.length === 0 && data.parent === null) {
    html += '<div class="dir-browser-empty">Nenhum subdiretório encontrado.</div>';
  } else {
    html += data.dirs.map((d) =>
      `<div class="dir-browser-item" data-dir-path="${escapeHtml(d.path)}">${folderSvg}<span>${escapeHtml(d.name)}</span></div>`
    ).join('');
  }
  list.innerHTML = html;

  list.querySelectorAll('.dir-browser-item[data-dir-path]').forEach((item) => {
    item.addEventListener('click', () => loadDirBrowserPath(item.dataset.dirPath));
  });
}

document.querySelector('#browseDirBtn')?.addEventListener('click', openDirBrowser);
document.querySelector('#dirBrowserClose')?.addEventListener('click', closeDirBrowser);
document.querySelector('#dirBrowserCancel')?.addEventListener('click', closeDirBrowser);
document.querySelector('#dirBrowserBackdrop')?.addEventListener('click', closeDirBrowser);
document.querySelector('#dirBrowserSelect')?.addEventListener('click', () => {
  elements.storageLocationDir.value = _dirBrowserCurrentPath;
  closeDirBrowser();
});

// ─── Full Backup Picker Modal ─────────────────────────────
function askFullBackupSelection(fullBackups, profileName) {
  elements.fullBackupPickerOptions.innerHTML = fullBackups.map((b) => `
    <label class="modal-option">
      <input type="radio" name="fullBackupChoice" value="${escapeHtml(b.id)}" />
      <span>
        <strong>${escapeHtml(new Date(b.createdAt).toLocaleString('pt-BR'))}</strong>
        <small>${escapeHtml((b.containers || []).map((c) => c.containerName).join(', '))} · ${escapeHtml(b.status)}</small>
      </span>
    </label>
  `).join('');

  // Pre-select the most recent one
  const firstRadio = elements.fullBackupPickerOptions.querySelector('input[name="fullBackupChoice"]');
  if (firstRadio) firstRadio.checked = true;

  elements.fullBackupPickerModal.classList.remove('hidden');
  elements.fullBackupPickerModal.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const closeModal = () => {
      elements.fullBackupPickerModal.classList.add('hidden');
      elements.fullBackupPickerModal.setAttribute('aria-hidden', 'true');
      elements.fullBackupPickerOptions.innerHTML = '';
    };

    const cleanup = () => {
      elements.fullBackupPickerConfirm.removeEventListener('click', onConfirm);
      elements.fullBackupPickerClose.removeEventListener('click', onCancel);
      elements.fullBackupPickerModal.removeEventListener('click', onBackdropClick);
    };

    const onConfirm = () => {
      const selected = elements.fullBackupPickerOptions.querySelector('input[name="fullBackupChoice"]:checked');
      if (!selected) {
        showToast('Selecione um backup full.', true);
        return;
      }
      cleanup();
      closeModal();
      resolve(selected.value);
    };

    const onCancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };

    const onBackdropClick = (event) => {
      if (event.target.closest('[data-action="close-full-backup-picker"]')) onCancel();
    };

    elements.fullBackupPickerConfirm.addEventListener('click', onConfirm);
    elements.fullBackupPickerClose.addEventListener('click', onCancel);
    elements.fullBackupPickerModal.addEventListener('click', onBackdropClick);
  });
}

async function resolveFullBackupId(profileId, profile) {
  const backups = await api(`/api/profiles/${profileId}/backups`);
  const fullBackups = backups
    .filter((b) => b.mode === 'full' && (b.status === 'ok' || b.status === 'partial'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!fullBackups.length) {
    showToast('Não há backup full disponível. Execute um backup full primeiro.', true);
    return undefined; // signal: blocked
  }

  if (fullBackups.length === 1) {
    return fullBackups[0].id;
  }

  return askFullBackupSelection(fullBackups, profile.name);
}

function renderServers() {
  // Servers view was removed
}

// ─── Snapshot modal (browse de arquivos do backup) ───────────

const snapshotState = {
  backup: null,
  profile: null,
  activeContainerId: null,
  filesByContainer: {},
};

async function openSnapshotModal(backupId, profileId) {
  snapshotState.backup = null;
  snapshotState.filesByContainer = {};
  snapshotState.activeContainerId = null;

  let backup;
  try {
    backup = await api(`/api/backups/${encodeURIComponent(backupId)}`);
  } catch (error) {
    showToast(`Erro ao carregar backup: ${error.message}`, true);
    return;
  }

  const profile = state.profiles.find((p) => p.id === profileId) || { id: profileId, name: profileId };
  snapshotState.backup = backup;
  snapshotState.profile = profile;

  const modeLabel = backup.mode === 'full' ? 'Full' : 'Incremental';
  elements.snapshotModalSubtitle.textContent =
    `${escapeHtml(profile.name)} — ${new Date(backup.createdAt).toLocaleString('pt-BR')} — ${modeLabel}`;

  const containers = (backup.containers || []).filter((c) => c.status === 'ok' && c.archiveRelativePath);
  if (!containers.length) {
    showToast('Backup sem containers com arquivos disponíveis.', true);
    return;
  }

  elements.snapshotSearch.value = '';
  elements.snapshotFileList.innerHTML = '';
  elements.snapshotStats.textContent = '';
  elements.snapshotExtract.disabled = true;
  elements.snapshotExtract.textContent = 'Extrair selecionados';

  // Build container tabs
  if (containers.length > 1) {
    elements.snapshotContainerTabs.classList.remove('hidden');
    elements.snapshotContainerTabs.innerHTML = containers.map((c, i) => `
      <button class="snapshot-tab${i === 0 ? ' active' : ''}"
        data-container-id="${escapeHtml(c.containerId)}">${escapeHtml(c.containerName)}</button>
    `).join('');
    elements.snapshotContainerTabs.querySelectorAll('.snapshot-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        elements.snapshotContainerTabs.querySelectorAll('.snapshot-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        loadSnapshotContainerFiles(btn.dataset.containerId);
      });
    });
  } else {
    elements.snapshotContainerTabs.classList.add('hidden');
  }

  elements.snapshotModal.classList.remove('hidden');
  elements.snapshotModal.setAttribute('aria-hidden', 'false');

  await loadSnapshotContainerFiles(containers[0].containerId);
}

async function loadSnapshotContainerFiles(containerId) {
  snapshotState.activeContainerId = containerId;
  elements.snapshotLoading.classList.remove('hidden');
  elements.snapshotFileList.innerHTML = '';
  elements.snapshotStats.textContent = '';
  elements.snapshotExtract.disabled = true;
  elements.snapshotExtract.textContent = 'Extrair selecionados';
  elements.snapshotSearch.value = '';

  try {
    if (!snapshotState.filesByContainer[containerId]) {
      const result = await api(
        `/api/backups/${encodeURIComponent(snapshotState.backup.id)}/containers/${encodeURIComponent(containerId)}/files`,
      );
      snapshotState.filesByContainer[containerId] = result;
    }
    elements.snapshotLoading.classList.add('hidden');
    renderSnapshotFiles(snapshotState.filesByContainer[containerId].files, '');
  } catch (error) {
    elements.snapshotLoading.classList.add('hidden');
    elements.snapshotFileList.innerHTML = `<div class="snapshot-empty">Erro ao carregar: ${escapeHtml(error.message)}</div>`;
  }
}

function renderSnapshotFiles(files, filter) {
  const lc = filter.toLowerCase();
  const visible = filter ? files.filter((f) => !f.isDir && f.name.toLowerCase().includes(lc)) : files.filter((f) => !f.isDir);

  const fileCount = visible.length;
  const totalSize = visible.reduce((s, f) => s + (f.size || 0), 0);
  elements.snapshotStats.textContent = `${fileCount} arquivo(s) — ${formatBytes(totalSize)}`;

  if (!visible.length) {
    elements.snapshotFileList.innerHTML = '<div class="snapshot-empty">Nenhum arquivo encontrado.</div>';
    updateSnapshotExtractBtn();
    return;
  }

  // Group by directory
  const groups = new Map();
  for (const file of visible) {
    const slash = file.name.lastIndexOf('/');
    const dir = slash >= 0 ? file.name.slice(0, slash) : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  const folderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const rootIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

  elements.snapshotFileList.innerHTML = sortedGroups.map(([dir, dirFiles]) => {
    const header = dir
      ? `<div class="snapshot-dir-header">${folderIcon}<span>${escapeHtml(dir)}/</span></div>`
      : `<div class="snapshot-dir-header">${rootIcon}<span>(raiz)</span></div>`;

    const rows = dirFiles.map((file) => {
      const shortName = dir ? file.name.slice(dir.length + 1) : file.name;
      return `<label class="snapshot-file-item">
        <input type="checkbox" name="snapshotFile" value="${escapeHtml(file.name)}" />
        <span class="snapshot-file-name" title="${escapeHtml(file.name)}">${escapeHtml(shortName)}</span>
        <span class="snapshot-file-size">${formatBytes(file.size || 0)}</span>
        <span class="snapshot-file-mtime">${escapeHtml(file.mtime || '')}</span>
      </label>`;
    }).join('');

    return `<div class="snapshot-dir-group">${header}${rows}</div>`;
  }).join('');

  elements.snapshotFileList.querySelectorAll('input[name="snapshotFile"]').forEach((cb) => {
    cb.addEventListener('change', updateSnapshotExtractBtn);
  });
  updateSnapshotExtractBtn();
}

function updateSnapshotExtractBtn() {
  const checked = elements.snapshotFileList.querySelectorAll('input[name="snapshotFile"]:checked').length;
  elements.snapshotExtract.disabled = checked === 0;
  elements.snapshotExtract.textContent = checked > 0 ? `Extrair ${checked} arquivo(s)` : 'Extrair selecionados';
}

function closeSnapshotModal() {
  elements.snapshotModal.classList.add('hidden');
  elements.snapshotModal.setAttribute('aria-hidden', 'true');
}

elements.snapshotModalClose?.addEventListener('click', closeSnapshotModal);
elements.snapshotModal?.querySelector('[data-action="close-snapshot-modal"]')?.addEventListener('click', closeSnapshotModal);

elements.snapshotSearch?.addEventListener('input', () => {
  const data = snapshotState.filesByContainer[snapshotState.activeContainerId];
  if (data) renderSnapshotFiles(data.files, elements.snapshotSearch.value);
});

elements.snapshotSelectAll?.addEventListener('click', () => {
  const checkboxes = elements.snapshotFileList.querySelectorAll('input[name="snapshotFile"]:not(:disabled)');
  const allChecked = [...checkboxes].every((c) => c.checked);
  checkboxes.forEach((c) => { c.checked = !allChecked; });
  updateSnapshotExtractBtn();
});

elements.snapshotExtract?.addEventListener('click', async () => {
  const checked = [...elements.snapshotFileList.querySelectorAll('input[name="snapshotFile"]:checked')].map((c) => c.value);
  if (!checked.length) return;

  const containerId = snapshotState.activeContainerId;
  const backupId = snapshotState.backup.id;

  elements.snapshotExtract.disabled = true;
  elements.snapshotExtract.textContent = 'Preparando...';

  try {
    const token = localStorage.getItem('authToken');
    const resp = await fetch(
      `/api/backups/${encodeURIComponent(backupId)}/containers/${encodeURIComponent(containerId)}/extract`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-auth-token': token } : {}),
        },
        body: JSON.stringify({ paths: checked }),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Erro ao extrair arquivos.' }));
      throw new Error(err.error || 'Erro ao extrair arquivos.');
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = resp.headers.get('Content-Disposition') || '';
    const fnMatch = cd.match(/filename="?([^"]+)"?/);
    a.download = fnMatch ? fnMatch[1] : 'extract.tar.gz';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${checked.length} arquivo(s) extraído(s) com sucesso.`);
  } catch (error) {
    showToast(`Erro ao extrair: ${error.message}`, true);
  } finally {
    updateSnapshotExtractBtn();
  }
});

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

  host.innerHTML = rows.map(({ profile, backups }) => {
    const groups = groupBackupsByFull(backups);
    const totalBackups = backups.length;

    const groupsHtml = groups.length
      ? groups.map(({ full, incrementals }) => {
          const allInGroup = [full, ...incrementals];
          return `
            <tbody>
              ${renderBackupRow(full, profile, true)}
              ${incrementals.map((inc) => renderBackupRow(inc, profile, false)).join('')}
            </tbody>
          `;
        }).join('')
      : `<tbody><tr><td colspan="5" class="empty-row">Nenhum backup realizado.</td></tr></tbody>`;

    return `
      <div class="card">
        <div class="card-toolbar">
          <h2 class="card-title">${escapeHtml(profile.name)}</h2>
          <span class="badge">${escapeHtml(String(totalBackups))} backup(s)</span>
        </div>
        <div class="run-progress hidden" data-run-progress="${escapeHtml(profile.id)}"></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Status</th><th>Containers</th><th>Ações</th></tr></thead>
            ${groupsHtml}
          </table>
        </div>
      </div>
    `;
  }).join('');

  renderAllRunProgress();
}

function renderBackupRow(b, profile, isFull) {
  const hasRestorable = (b.containers || []).some((c) => c.status === 'ok');
  const indent = isFull ? '' : '&nbsp;&nbsp;&nbsp;↳&nbsp;';
  const modeLabel = isFull ? 'Full' : 'Incremental';
  return `
    <tr${isFull ? '' : ' class="incremental-row"'}>
      <td>${indent}${escapeHtml(new Date(b.createdAt).toLocaleString('pt-BR'))}</td>
      <td><span class="badge badge--${escapeHtml(b.mode || 'full')}">${escapeHtml(modeLabel)}</span></td>
      <td><span class="status-badge status-badge--${escapeHtml(b.status)}">${escapeHtml(b.status)}</span></td>
      <td>${escapeHtml((b.containers || []).map((c) => c.containerName).join(', '))}</td>
      <td>
        <button
          class="btn btn--secondary btn--sm btn--icon"
          data-action="browse-backup"
          data-profile-id="${escapeHtml(profile.id)}"
          data-backup-id="${escapeHtml(b.id)}"
          title="Ver arquivos do backup"
        ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
        <button
          class="btn btn--secondary btn--sm"
          data-action="restore"
          data-profile-id="${escapeHtml(profile.id)}"
          data-backup-id="${escapeHtml(b.id)}"
          ${hasRestorable ? '' : 'disabled title="Nenhum container restaurável"'}
        >Restore</button>
      </td>
    </tr>
  `;
}

function groupBackupsByFull(backups) {
  const chronological = [...backups].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const groupMap = new Map();
  let currentFullId = null;

  for (const backup of chronological) {
    if (backup.mode === 'full') {
      currentFullId = backup.id;
      groupMap.set(currentFullId, { full: backup, incrementals: [] });
    } else if (backup.mode === 'incremental') {
      const targetId = backup.basedOnFullBackupId || currentFullId;
      if (targetId && groupMap.has(targetId)) {
        groupMap.get(targetId).incrementals.push(backup);
      }
    }
  }

  return [...groupMap.values()].sort((a, b) => new Date(b.full.createdAt) - new Date(a.full.createdAt));
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
        <td><button class="btn btn--secondary btn--sm run-log-btn" data-backup-id="${escapeHtml(b.id)}">Log</button></td>
      </tr>
    `;
  }).join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 401) {
    authToken = null;
    localStorage.removeItem('authToken');
    showLoginOverlay();
    throw new Error('Sessao expirada. Faca login novamente.');
  }

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

function renderContainerOption(container, selected) {
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
}

function renderContainers() {
  elements.containerCount.textContent = String(state.containers.length);

  const eligible = state.containers.filter((container) => container.state !== 'created');

  if (!eligible.length) {
    elements.containerOptions.innerHTML = '<p class="empty-state">Nenhum container encontrado.</p>';
    return;
  }

  const selected = new Set(getSelectedContainerIds());

  // Separate compose containers from standalone
  const composeGroups = new Map(); // project -> container[]
  const standalone = [];

  for (const container of eligible) {
    if (container.composeProject) {
      if (!composeGroups.has(container.composeProject)) composeGroups.set(container.composeProject, []);
      composeGroups.get(container.composeProject).push(container);
    } else {
      standalone.push(container);
    }
  }

  const parts = [];

  // Compose groups first, sorted by project name
  for (const [project, containers] of [...composeGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`<div class="compose-group">
      <div class="compose-group-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <span>${escapeHtml(project)}</span>
      </div>
      ${containers.map((c) => renderContainerOption(c, selected)).join('')}
    </div>`);
  }

  // Standalone containers
  if (standalone.length) {
    const standaloneHeader = composeGroups.size > 0
      ? `<div class="compose-group">
        <div class="compose-group-header compose-group-header--standalone">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          <span>Containers avulsos</span>
        </div>
        ${standalone.map((c) => renderContainerOption(c, selected)).join('')}
      </div>`
      : standalone.map((c) => renderContainerOption(c, selected)).join('');
    parts.push(standaloneHeader);
  }

  elements.containerOptions.innerHTML = parts.join('');
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
        <button data-action="run" data-profile-id="${escapeHtml(profile.id)}" class="btn btn--primary btn--sm" ${isRunning ? 'disabled' : ''}>${isRunning ? 'Executando...' : 'Run'}</button>
        <button data-action="edit" data-profile-id="${escapeHtml(profile.id)}" class="btn btn--secondary btn--sm">Editar</button>
        <button data-action="delete" data-profile-id="${escapeHtml(profile.id)}" class="btn btn--danger btn--sm">Excluir</button>
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

async function askVolumeSelection(containerId, containerName, currentSelections, sourceId) {
  let mounts;
  try {
    const mountsUrl = sourceId
      ? `/api/containers/${encodeURIComponent(containerId)}/mounts?sourceId=${encodeURIComponent(sourceId)}`
      : `/api/containers/${encodeURIComponent(containerId)}/mounts`;
    mounts = await api(mountsUrl);
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
  const sourceId = elements.profileSourceSelect?.value || null;
  const selected = await askVolumeSelection(containerId, containerName, currentSelections, sourceId);

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
  // Atualiza TODOS os elementos com o atributo (pode existir na aba Profiles E na aba Backups).
  const hosts = document.querySelectorAll(`[data-run-progress="${CSS.escape(profileId)}"]`);
  if (!hosts.length) {
    return;
  }

  if (!run || !run.progress) {
    for (const host of hosts) {
      host.innerHTML = '';
      host.classList.add('hidden');
    }
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

  const progressHtml = `
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

  for (const host of hosts) {
    host.classList.remove('hidden');
    host.innerHTML = progressHtml;
  }
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
  populateStorageLocationDropdown();
  populateSourceDropdown();
  if (profile.storageLocationId) {
    elements.storageLocationSelect.value = profile.storageLocationId;
  }
  if (elements.profileSourceSelect) {
    elements.profileSourceSelect.value = profile.sourceId || '';
  }
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
  const storageLocationId = elements.storageLocationSelect.value;

  if (!storageLocationId) {
    showToast('Selecione um local de armazenamento.', true);
    return;
  }

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
    storageLocationId,
    sourceId: elements.profileSourceSelect?.value || undefined,
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

      let basedOnFullBackupId = null;
      if (mode === 'incremental') {
        const result = await resolveFullBackupId(profileId, profile);
        if (result === undefined) {
          // Blocked: no full backup available
          button.disabled = false;
          button.textContent = 'Run';
          return;
        }
        if (result === null) {
          // User cancelled modal
          button.disabled = false;
          button.textContent = 'Run';
          return;
        }
        basedOnFullBackupId = result;
      }

      const start = await api(`/api/profiles/${profileId}/run`, { method: 'POST', body: JSON.stringify({ mode, basedOnFullBackupId }) });
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

    if (action === 'browse-backup') {
      openSnapshotModal(backupId, profileId);
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
      if (!document.querySelector('#view-backups')?.classList.contains('hidden')) {
        await renderBackupsView();
      }

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

// ─── Schedules ────────────────────────────────────────────
const FREQUENCY_LABELS = {
  once: 'Única vez',
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
};

async function loadSchedules() {
  try {
    state.schedules = await api('/api/schedules');
    renderSchedulesList();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderSchedulesList() {
  const list = document.querySelector('#schedulesList');
  if (!list) return;

  if (!state.schedules.length) {
    list.innerHTML = '<p class="empty-state">Nenhum agendamento configurado. Crie um para automatizar seus backups.</p>';
    return;
  }

  list.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Profile</th>
          <th>Tipo</th>
          <th>Frequência</th>
          <th>Próxima Execução</th>
          <th>Última Execução</th>
          <th>Status</th>
          <th>Ativo</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${state.schedules.map((schedule) => {
          const profile = state.profiles.find((p) => p.id === schedule.profileId);
          const profileName = profile ? profile.name : '—';
          let nextRun = '—';
          if (schedule.frequency === 'once' && schedule.lastRunAt && !schedule.nextRunAt) {
            nextRun = 'Concluído';
          } else if (!schedule.enabled) {
            nextRun = 'Pausado';
          } else if (schedule.nextRunAt) {
            nextRun = new Date(schedule.nextRunAt).toLocaleString('pt-BR');
          }
          const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString('pt-BR') : 'Nunca';
          const statusBadge = schedule.lastRunStatus
            ? `<span class="status-badge status-badge--${escapeHtml(schedule.lastRunStatus === 'ok' ? 'ok' : 'error')}">${escapeHtml(schedule.lastRunStatus)}</span>`
            : '—';
          return `
            <tr>
              <td><strong>${escapeHtml(schedule.name || '—')}</strong></td>
              <td>${escapeHtml(profileName)}</td>
              <td><span class="badge badge--${escapeHtml(schedule.backupMode || 'full')}">${escapeHtml(schedule.backupMode === 'incremental' ? 'Incremental' : 'Full')}</span></td>
              <td>${escapeHtml(FREQUENCY_LABELS[schedule.frequency] || schedule.frequency)}</td>
              <td>${escapeHtml(nextRun)}</td>
              <td>${escapeHtml(lastRun)}</td>
              <td>${statusBadge}</td>
              <td style="text-align:center">
                <input type="checkbox" class="schedule-toggle" data-schedule-id="${escapeHtml(schedule.id)}" ${schedule.enabled ? 'checked' : ''} title="${schedule.enabled ? 'Pausar' : 'Ativar'}" />
              </td>
              <td>
                <button class="btn btn--secondary btn--sm" data-schedule-action="edit" data-schedule-id="${escapeHtml(schedule.id)}">Editar</button>
                <button class="btn btn--danger btn--sm" data-schedule-action="delete" data-schedule-id="${escapeHtml(schedule.id)}">Excluir</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function openScheduleModal(schedule = null) {
  const title = document.querySelector('#scheduleModalTitle');
  const form = document.querySelector('#scheduleForm');
  if (!form || !title) return;

  form.reset();
  document.querySelector('#scheduleId').value = '';
  document.querySelector('#scheduleFullBackupField').classList.add('hidden');
  document.querySelector('#scheduleBasedOnFullBackupId').innerHTML =
    '<option value="">Auto (usar o mais recente disponível)</option>';

  const profileSelect = document.querySelector('#scheduleProfileId');
  profileSelect.innerHTML = '<option value="">Selecione um profile...</option>' +
    state.profiles.map((p) =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
    ).join('');

  const defaultDate = new Date();
  defaultDate.setHours(defaultDate.getHours() + 1, 0, 0, 0);
  document.querySelector('#scheduleDateTime').value = defaultDate.toISOString().slice(0, 16);
  document.querySelector('#scheduleEnabled').checked = true;

  if (schedule) {
    title.textContent = 'Editar Agendamento';
    document.querySelector('#scheduleId').value = schedule.id;
    document.querySelector('#scheduleName').value = schedule.name || '';
    profileSelect.value = schedule.profileId;

    const modeRadio = document.querySelector(`input[name="scheduleBackupMode"][value="${schedule.backupMode || 'full'}"]`);
    if (modeRadio) modeRadio.checked = true;

    document.querySelector('#scheduleFrequency').value = schedule.frequency || 'daily';
    document.querySelector('#scheduleEnabled').checked = schedule.enabled !== false;

    if (schedule.scheduledAt) {
      document.querySelector('#scheduleDateTime').value = schedule.scheduledAt.slice(0, 16);
    }

    if (schedule.backupMode === 'incremental') {
      document.querySelector('#scheduleFullBackupField').classList.remove('hidden');
      await loadFullBackupsForSchedule(schedule.profileId, schedule.basedOnFullBackupId);
    }
  } else {
    title.textContent = 'Novo Agendamento';
  }

  document.querySelector('#scheduleFormModal').classList.remove('hidden');
  document.querySelector('#scheduleFormModal').setAttribute('aria-hidden', 'false');
}

function closeScheduleModal() {
  document.querySelector('#scheduleFormModal').classList.add('hidden');
  document.querySelector('#scheduleFormModal').setAttribute('aria-hidden', 'true');
}

async function loadFullBackupsForSchedule(profileId, selectedId = null) {
  const select = document.querySelector('#scheduleBasedOnFullBackupId');
  if (!select) return;

  select.innerHTML = '<option value="">Auto (usar o mais recente disponível)</option>';
  if (!profileId) return;

  try {
    const backups = await api(`/api/profiles/${profileId}/backups`);
    const fullBackups = backups
      .filter((b) => b.mode === 'full' && (b.status === 'ok' || b.status === 'partial'))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    for (const b of fullBackups) {
      const label = `${new Date(b.createdAt).toLocaleString('pt-BR')} · ${(b.containers || []).map((c) => c.containerName).join(', ')} · ${b.status}`;
      const option = document.createElement('option');
      option.value = b.id;
      option.textContent = label;
      select.appendChild(option);
    }

    if (selectedId) select.value = selectedId;
  } catch {
    // Non-fatal
  }
}

document.querySelector('#schedulesList')?.addEventListener('change', async (e) => {
  const checkbox = e.target.closest('.schedule-toggle');
  if (!checkbox) return;

  const scheduleId = checkbox.dataset.scheduleId;
  try {
    await api(`/api/schedules/${scheduleId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: checkbox.checked }),
    });
    showToast(checkbox.checked ? 'Agendamento ativado.' : 'Agendamento pausado.');
    await loadSchedules();
  } catch (error) {
    showToast(error.message, true);
    checkbox.checked = !checkbox.checked;
  }
});

document.querySelector('#schedulesList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-schedule-action]');
  if (!btn) return;

  const { scheduleAction, scheduleId } = btn.dataset;
  const schedule = state.schedules.find((s) => s.id === scheduleId);
  if (!schedule) return;

  if (scheduleAction === 'delete') {
    if (!window.confirm(`Excluir o agendamento "${schedule.name || 'sem nome'}"?`)) return;
    try {
      await api(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      await loadSchedules();
      showToast('Agendamento removido.');
    } catch (error) {
      showToast(error.message, true);
    }
  } else if (scheduleAction === 'edit') {
    if (!state.profiles.length) await loadProfiles();
    await openScheduleModal(schedule);
  }
});

document.querySelector('#openCreateScheduleModal')?.addEventListener('click', async () => {
  if (!state.profiles.length) await loadProfiles();
  await openScheduleModal();
});

document.querySelector('#scheduleModalClose')?.addEventListener('click', closeScheduleModal);
document.querySelector('#cancelScheduleForm')?.addEventListener('click', closeScheduleModal);
document.querySelector('#scheduleFormModal')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-schedule-modal"]')) closeScheduleModal();
});

document.querySelector('#scheduleProfileId')?.addEventListener('change', async (e) => {
  const mode = document.querySelector('input[name="scheduleBackupMode"]:checked')?.value;
  if (mode === 'incremental') {
    await loadFullBackupsForSchedule(e.target.value, null);
  }
});

document.querySelectorAll('input[name="scheduleBackupMode"]').forEach((radio) => {
  radio.addEventListener('change', async (e) => {
    const fullField = document.querySelector('#scheduleFullBackupField');
    if (e.target.value === 'incremental') {
      fullField.classList.remove('hidden');
      const profileId = document.querySelector('#scheduleProfileId').value;
      await loadFullBackupsForSchedule(profileId, null);
    } else {
      fullField.classList.add('hidden');
    }
  });
});

document.querySelector('#scheduleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const profileId = document.querySelector('#scheduleProfileId').value;
  if (!profileId) {
    showToast('Selecione um profile.', true);
    return;
  }

  const dateTimeValue = document.querySelector('#scheduleDateTime').value;
  if (!dateTimeValue) {
    showToast('Informe a data e hora de início.', true);
    return;
  }

  const backupMode = document.querySelector('input[name="scheduleBackupMode"]:checked')?.value || 'full';
  const basedOnFullBackupId = backupMode === 'incremental'
    ? (document.querySelector('#scheduleBasedOnFullBackupId').value || null)
    : null;

  const payload = {
    id: document.querySelector('#scheduleId').value || undefined,
    name: document.querySelector('#scheduleName').value.trim(),
    profileId,
    backupMode,
    basedOnFullBackupId,
    frequency: document.querySelector('#scheduleFrequency').value,
    scheduledAt: new Date(dateTimeValue).toISOString(),
    enabled: document.querySelector('#scheduleEnabled').checked,
  };

  try {
    await api('/api/schedules', { method: 'POST', body: JSON.stringify(payload) });
    closeScheduleModal();
    await loadSchedules();
    showToast('Agendamento salvo.');
  } catch (error) {
    showToast(error.message, true);
  }
});

// ─── Login overlay ────────────────────────────────────────
function showLoginOverlay() {
  const overlay = document.querySelector('#loginOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.querySelector('#logoutBtn')?.classList.add('hidden');
}

function hideLoginOverlay() {
  const overlay = document.querySelector('#loginOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

document.querySelector('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.querySelector('#loginUsername')?.value || '';
  const password = document.querySelector('#loginPassword')?.value || '';
  const errorEl = document.querySelector('#loginError');
  try {
    const result = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await result.json();
    if (!result.ok) {
      errorEl?.classList.remove('hidden');
      return;
    }
    errorEl?.classList.add('hidden');
    authToken = data.token;
    if (authToken) localStorage.setItem('authToken', authToken);
    hideLoginOverlay();
    document.querySelector('#logoutBtn')?.classList.remove('hidden');
    await init();
  } catch {
    errorEl?.classList.remove('hidden');
  }
});

document.querySelector('#logoutBtn')?.addEventListener('click', () => {
  authToken = null;
  localStorage.removeItem('authToken');
  showLoginOverlay();
});

async function checkAuthAndInit() {
  try {
    const status = await fetch('/api/auth-status').then((r) => r.json());
    if (!status.requireAuth) {
      hideLoginOverlay();
      await init();
      return;
    }
    // Auth required
    if (authToken) {
      // Try using stored token
      const probe = await fetch('/api/profiles', { headers: { 'x-auth-token': authToken } });
      if (probe.ok) {
        hideLoginOverlay();
        document.querySelector('#logoutBtn')?.classList.remove('hidden');
        await init();
        return;
      }
      // Token invalid
      authToken = null;
      localStorage.removeItem('authToken');
    }
    showLoginOverlay();
  } catch {
    // If health check fails, still show the app (might be first load)
    await init();
  }
}

// ─── Settings ─────────────────────────────────────────────
function buildLanguageSelect() {
  const select = document.querySelector('#settingsLanguage');
  if (!select) return;
  select.innerHTML = Object.entries(LOCALE_NAMES).map(([code, name]) =>
    `<option value="${code}">${name}</option>`
  ).join('');
  select.value = currentLang;
}

async function loadSettingsView() {
  buildLanguageSelect();
  const themeSelect = document.querySelector('#settingsTheme');
  if (themeSelect) themeSelect.value = localStorage.getItem('theme') || 'default';
  try {
    const settings = await api('/api/settings');
    const select = document.querySelector('#settingsLanguage');
    if (select && settings.language) select.value = settings.language;
    const authCheck = document.querySelector('#settingsRequireAuth');
    if (authCheck) authCheck.checked = settings.requireAuth;
    const authFields = document.querySelector('#authFields');
    if (authFields) authFields.classList.toggle('hidden', !settings.requireAuth);
    const usernameField = document.querySelector('#settingsUsername');
    if (usernameField) usernameField.value = settings.username || '';
  } catch {
    // Non-fatal: use defaults
  }
}

document.querySelector('#settingsRequireAuth')?.addEventListener('change', (e) => {
  document.querySelector('#authFields')?.classList.toggle('hidden', !e.target.checked);
});

document.querySelector('#saveSettingsBtn')?.addEventListener('click', async () => {
  const language = document.querySelector('#settingsLanguage')?.value || currentLang;
  const requireAuth = document.querySelector('#settingsRequireAuth')?.checked || false;
  const username = document.querySelector('#settingsUsername')?.value?.trim() || '';
  const password = document.querySelector('#settingsPassword')?.value || '';

  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ language, requireAuth, username, password: password || undefined }),
    });
    currentLang = language;
    localStorage.setItem('lang', language);
    applyTranslations();
    showToast(t('settings.saved'));
  } catch (error) {
    showToast(error.message, true);
  }
});

// ─── About ────────────────────────────────────────────────
function markdownInline(raw) {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function parseChangelogSection(markdown, maxEntries = 4) {
  // Extract from ## Changelog (or ## 🗂 Changelog etc.) to next ##
  const start = markdown.search(/^##\s+[^\n]*[Cc]hangelog/m);
  if (start === -1) return null;
  const rest = markdown.slice(start);
  const nextSection = rest.slice(1).search(/^## /m);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection + 1);

  const lines = section.split('\n');
  let html = '';
  let inList = false;
  let entryCount = 0;

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/);
    const h4 = line.match(/^####\s+(.+)/);
    const li = line.match(/^-\s+(.+)/);

    if (h3) {
      if (entryCount >= maxEntries) break;
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h4>${markdownInline(h3[1].replace(/\[([^\]]+)\]/, '$1'))}</h4>`;
      entryCount += 1;
    } else if (h4) {
      if (entryCount > maxEntries) break;
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h5 class="changelog-section">${markdownInline(h4[1])}</h5>`;
    } else if (li) {
      if (entryCount > maxEntries) break;
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${markdownInline(li[1])}</li>`;
    } else if (line.startsWith('---') || line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
    }
  }
  if (inList) html += '</ul>';
  return html || null;
}

async function loadAboutView() {
  const currentVerEl = document.querySelector('#aboutCurrentVersion');
  const latestVerEl = document.querySelector('#aboutLatestVersion');
  const updateWrap = document.querySelector('#aboutUpdateWrap');
  const updateStatus = document.querySelector('#aboutUpdateStatus');
  const updateBtn = document.querySelector('#aboutUpdateBtn');
  const changelogEl = document.querySelector('#aboutChangelog');

  if (latestVerEl) latestVerEl.textContent = t('about.checking');

  // Fetch version info and changelog in parallel
  const [aboutResult, changelogResult] = await Promise.allSettled([
    api('/api/about'),
    fetch('https://raw.githubusercontent.com/asabino2/dockerbackup/main/README.md').then((r) => r.text()),
  ]);

  // Version info
  if (aboutResult.status === 'fulfilled') {
    const about = aboutResult.value;
    const current = about.currentVersion || '—';
    const latest = about.latestVersion || null;

    if (currentVerEl) currentVerEl.textContent = current;
    if (latestVerEl) latestVerEl.textContent = latest || '—';

    if (updateWrap) updateWrap.classList.remove('hidden');
    if (latest && current !== latest) {
      if (updateStatus) updateStatus.textContent = t('about.updateAvailable');
      if (updateBtn) updateBtn.classList.remove('hidden');
    } else if (latest) {
      if (updateStatus) updateStatus.textContent = t('about.upToDate');
      if (updateBtn) updateBtn.classList.add('hidden');
    } else {
      if (updateStatus) updateStatus.textContent = t('about.checkError');
      if (updateBtn) updateBtn.classList.add('hidden');
    }
  } else {
    if (currentVerEl) currentVerEl.textContent = '—';
    if (latestVerEl) latestVerEl.textContent = '—';
    showToast(aboutResult.reason?.message || 'Erro ao buscar versão', true);
  }

  // Changelog from GitHub README
  if (changelogEl) {
    if (changelogResult.status === 'fulfilled') {
      const html = parseChangelogSection(changelogResult.value);
      changelogEl.innerHTML = html || '<p class="changelog-loading">Changelog não encontrado.</p>';
    } else {
      changelogEl.innerHTML = '<p class="changelog-loading">Não foi possível carregar o changelog.</p>';
    }
  }
}

document.querySelector('#aboutUpdateBtn')?.addEventListener('click', async () => {
  const btn = document.querySelector('#aboutUpdateBtn');
  const status = document.querySelector('#aboutUpdateStatus');
  if (btn) { btn.disabled = true; btn.textContent = t('about.updating'); }
  try {
    await api('/api/update', { method: 'POST' });
    if (status) status.textContent = t('about.updateSuccess');
    showToast(t('about.updateSuccess'));
  } catch (error) {
    if (btn) { btn.disabled = false; btn.textContent = t('about.update'); }
    if (status) status.textContent = t('about.updateError');
    showToast(error.message, true);
  }
});

async function init() {
  applyTranslations();
  try {
    await Promise.all([loadContainers(), loadProfiles(), loadStorageLocations(), loadSources()]);
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

// Run log modal
document.querySelector('#allRunsBody')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.run-log-btn');
  if (!btn) return;
  const backupId = btn.dataset.backupId;
  if (!backupId) return;
  openRunLogModal(backupId);
});

document.querySelector('#runLogModalClose')?.addEventListener('click', () => {
  document.querySelector('#runLogModal')?.classList.add('hidden');
});
document.querySelector('#runLogModal')?.addEventListener('click', (e) => {
  if (e.target.dataset.action === 'close-run-log-modal') {
    document.querySelector('#runLogModal').classList.add('hidden');
  }
});

async function openRunLogModal(backupId) {
  const modal = document.querySelector('#runLogModal');
  const content = document.querySelector('#runLogContent');
  if (!modal || !content) return;
  modal.classList.remove('hidden');
  content.innerHTML = '<p class="changelog-loading">Carregando log...</p>';
  try {
    const backup = await api(`/api/backups/${encodeURIComponent(backupId)}`);
    const containers = backup.containers || [];
    if (!containers.length) {
      content.innerHTML = '<p class="changelog-loading">Nenhum log disponível para este backup.</p>';
      return;
    }
    let html = '';
    for (const c of containers) {
      const name = escapeHtml(c.containerName || c.containerId || '?');
      const status = escapeHtml(c.status || '—');
      html += `<div class="run-log-section">`;
      html += `<h4 class="run-log-container-name">${name} <span class="status-badge status-badge--${escapeHtml(c.status || '')}">${status}</span></h4>`;
      if (c.error) {
        html += `<div class="run-log-error"><strong>Erro:</strong> ${escapeHtml(c.error)}</div>`;
      }
      const logs = c.logs || [];
      if (logs.length) {
        html += `<pre class="run-log-pre">${logs.map((l) => escapeHtml(l)).join('\n')}</pre>`;
      } else {
        html += `<p class="run-log-empty">Sem log detalhado (backup pode ter sido criado antes desta versão).</p>`;
      }
      html += `</div>`;
    }
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<p class="changelog-loading">Erro ao carregar log: ${escapeHtml(err.message)}</p>`;
  }
}

// Apply translations early (before auth check so login page is translated)
applyTranslations();
checkAuthAndInit();