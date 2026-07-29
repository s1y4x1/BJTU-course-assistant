(function () {
  'use strict';

  const ENABLED_KEY = 'backgroundAutoUpdateEnabled';
  const INSTALL_OPTIONAL_KEY = 'backgroundAutoInstallOptionalEnabled';
  const INTERVAL_KEY = 'backgroundAutoUpdateIntervalMinutes';
  const DEFAULT_INTERVAL_MINUTES = 30;
  const STATUS_KEY = 'backgroundAutoUpdateStatus';
  const DETECTED_NOTIFICATION_VERSION_KEY = 'backgroundUpdateDetectedNotifiedVersion';
  const ISSUE_NOTIFICATIONS_KEY = 'backgroundUpdateIssueNotifications';
  const ALARM_NAME = 'bjtu-background-update-check';
  const DETECTED_NOTIFICATION_PREFIX = 'bjtu-background-update-detected:';
  const COMPLETE_NOTIFICATION_PREFIX = 'bjtu-background-update-complete:';
  const ISSUE_NOTIFICATION_PREFIX = 'bjtu-background-update-issue:';
  const SOURCE_URLS = [
    'https://s1y4x1.github.io/release.json'
  ];
  const FS_DB_NAME = 'bjtu-course-assistant-update-filesystem';
  const FS_STORE_NAME = 'handles';
  const FS_DIRECTORY_KEY = 'update-directory';
  const APPLIED_WITHOUT_RELOAD_KEY = 'appliedUpdateWithoutReload';
  const PENDING_RELOAD_KEY = 'pendingUpdateReload';
  const RELOAD_HANDOFF_KEY = 'versionAutoReloadHandoff';
  const MODULE_SELECTION_KEY = 'updateModuleSelection';
  const OPTIONAL_MODULE_IDS = ['ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx', 'academic', 'campusnet', 'captcha', 'updater'];
  const MODULE_SCOPE_IDS = ['ve', ...OPTIONAL_MODULE_IDS];
  const REQUIRED_MODULE_IDS = new Set(['ve', 'updater']);
  const ROOT_COMPONENT_DIRECTORY_NAMES = Object.freeze({
    _locales: '_locales',
    app: 'app',
    cache: 'cache',
    core: 'core',
    icons: 'icons',
    options: 'options',
    popup: 'popup',
    qr: 'QR',
    ui: 'UI',
    uploads: 'uploads'
  });
  const ROOT_COMPONENT_IDS = new Set(Object.keys(ROOT_COMPONENT_DIRECTORY_NAMES));
  const IGNORED_ARCHIVE_DIRECTORIES = new Set(['.agents', '.git', '.github', '.mimocode']);
  const STALE_RELOAD_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
  let runningPromise = null;
  let supplementalReloadRequired = false;

  function normalizeIntervalMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600
      ? minutes
      : DEFAULT_INTERVAL_MINUTES;
  }

  function normalizeVersion(value) {
    return String(value || '').trim().replace(/^v/i, '').split(/[+-]/, 1)[0];
  }

  function compareVersions(left, right) {
    const a = normalizeVersion(left).split('.').map((part) => Number(part) || 0);
    const b = normalizeVersion(right).split('.').map((part) => Number(part) || 0);
    const count = Math.max(a.length, b.length);
    for (let index = 0; index < count; index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  async function setStatus(status, extra = {}) {
    await chrome.storage.local.set({
      [STATUS_KEY]: { status, ...extra, checkedAt: Date.now() }
    });
  }

  function createSystemNotification(notificationId, options, source, replaceExisting = false) {
    if (globalThis.BjtuSystemNotifications?.create) {
      return globalThis.BjtuSystemNotifications.create(notificationId, options, source, replaceExisting);
    }
    return chrome.notifications.create(notificationId, options);
  }

  async function notifyUpdateDetected(release, lastNotifiedVersion = '', installOptionalUpdate = false) {
    if (normalizeVersion(lastNotifiedVersion) === normalizeVersion(release?.version)) return false;
    try {
      const notificationId = `${DETECTED_NOTIFICATION_PREFIX}${normalizeVersion(release?.version) || 'unknown'}`;
      await createSystemNotification(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `发现新版本：${String(release?.name || release?.version || '新版本')}`,
        message: release?.force
          ? '这是强制更新，即将开始后台下载。'
          : (installOptionalUpdate
            ? '检测到非强制更新，根据您的后台更新设置，将自动开始更新。'
            : '检测到非强制更新，根据您的后台更新设置，本次不自动更新，您可以手动选择更新。'),
        priority: 1
      }, 'background-update-detected');
      await chrome.storage.local.set({
        [DETECTED_NOTIFICATION_VERSION_KEY]: String(release?.version || '')
      });
      return true;
    } catch {
      // A notification failure must not prevent the update itself.
      return false;
    }
  }

  async function notifyUpdateComplete(release, message) {
    const notificationId = `${COMPLETE_NOTIFICATION_PREFIX}${normalizeVersion(release?.version) || 'unknown'}`;
    await createSystemNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'BJTU 课程助手已后台更新',
      message: String(message || `已更新到 ${release?.name || release?.version || '新版本'}。`),
      priority: 1
    }, 'background-update-complete', true);
    return notificationId;
  }

  function classifyUpdateIssue(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    const text = `${name} ${message}`.toLowerCase();
    if (/notallowed|securityerror|nomodificationallowed|permission|权限|授权|写入|更新目录/.test(text)) {
      return 'permission';
    }
    if (/aborterror|timeout|failed to fetch|network|网络|连接|更新源|下载更新包|http\s*\d+/.test(text)) {
      return 'network';
    }
    return '';
  }

  async function retryNetworkOperation(operation, retryCount = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (classifyUpdateIssue(error) !== 'network' || attempt >= retryCount) throw error;
      }
    }
    throw lastError || new Error('网络请求失败');
  }

  async function notifyUpdateIssue(category, message, version = '') {
    if (category !== 'permission') return false;
    const detail = String(message || '无法写入扩展安装目录');
    const signature = `${normalizeVersion(version)}|${detail}`;
    const stored = await chrome.storage.local.get([ISSUE_NOTIFICATIONS_KEY]).catch(() => ({}));
    const notified = stored?.[ISSUE_NOTIFICATIONS_KEY] && typeof stored[ISSUE_NOTIFICATIONS_KEY] === 'object'
      ? { ...stored[ISSUE_NOTIFICATIONS_KEY] }
      : {};
    if (notified[category] === signature) return false;
    try {
      await createSystemNotification(`${ISSUE_NOTIFICATION_PREFIX}${category}`, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: '后台更新无法写入目录',
        message: detail,
        priority: 2
      }, 'background-update-issue', true);
      notified[category] = signature;
      await chrome.storage.local.set({ [ISSUE_NOTIFICATIONS_KEY]: notified });
      return true;
    } catch {
      return false;
    }
  }

  async function clearUpdateIssueNotificationState(category) {
    const stored = await chrome.storage.local.get([ISSUE_NOTIFICATIONS_KEY]).catch(() => ({}));
    const notified = stored?.[ISSUE_NOTIFICATIONS_KEY] && typeof stored[ISSUE_NOTIFICATIONS_KEY] === 'object'
      ? { ...stored[ISSUE_NOTIFICATIONS_KEY] }
      : {};
    if (!Object.prototype.hasOwnProperty.call(notified, category)) return;
    delete notified[category];
    await chrome.storage.local.set({ [ISSUE_NOTIFICATIONS_KEY]: notified }).catch(() => {});
  }

  async function fetchRelease(sourceUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(sourceUrl, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = JSON.parse(String(await response.text()).replace(/^\uFEFF/, ''));
      const version = String(data?.ver || '').trim();
      const url = String(data?.url || '').trim();
      if (!version || !/^https?:\/\//i.test(url)) throw new Error('更新源数据不完整');
      return {
        version,
        name: String(data?.name || version).trim() || version,
        description: String(data?.desc || '').trim(),
        url: new URL(url).href,
        reload: data?.reload !== false,
        force: data?.force === true,
        update: Array.isArray(data?.update) ? data.update : null,
        clean: data?.clean === true,
        sourceUrl
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchLatestRelease() {
    const settled = await Promise.allSettled(SOURCE_URLS.map((sourceUrl) => (
      retryNetworkOperation(() => fetchRelease(sourceUrl), 2)
    )));
    const releases = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    if (!releases.length) {
      const reason = settled.find((item) => item.status === 'rejected')?.reason;
      throw new Error(`无法连接更新源${reason ? `：${String(reason.message || reason)}` : ''}`);
    }
    return releases.reduce((latest, release) => (
      compareVersions(release.version, latest.version) > 0 ? release : latest
    ));
  }

  function openFileSystemDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FS_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FS_STORE_NAME)) {
          request.result.createObjectStore(FS_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开更新目录数据库'));
    });
  }

  async function readDirectoryHandle() {
    const db = await openFileSystemDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(FS_STORE_NAME, 'readonly');
        const request = transaction.objectStore(FS_STORE_NAME).get(FS_DIRECTORY_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('无法读取更新目录'));
      });
    } finally {
      db.close();
    }
  }

  async function clearStoredDirectoryHandle() {
    const db = await openFileSystemDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(FS_STORE_NAME, 'readwrite');
        transaction.objectStore(FS_STORE_NAME).delete(FS_DIRECTORY_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法清除已失效的更新目录'));
        transaction.onabort = () => reject(transaction.error || new Error('清除已失效的更新目录已中止'));
      });
    } finally {
      db.close();
    }
  }

  async function validateDirectory(handle) {
    if (!handle || handle.kind !== 'directory' || typeof handle.queryPermission !== 'function') return null;
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return null;
    const manifestHandle = await handle.getFileHandle('manifest.json');
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json 格式无效');
    return handle;
  }

  function findZipEnd(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error('更新压缩包结构无效');
  }

  function parseZipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const end = findZipEnd(bytes);
    const count = view.getUint16(end + 10, true);
    const centralOffset = view.getUint32(end + 16, true);
    if (count === 0xffff || centralOffset === 0xffffffff) throw new Error('暂不支持 ZIP64 更新包');
    const decoder = new TextDecoder('utf-8');
    const entries = [];
    let offset = centralOffset;
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('更新压缩包目录损坏');
      }
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (flags & 1) throw new Error('更新压缩包已加密');
      const nameStart = offset + 46;
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, '/');
      if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('更新压缩包文件记录损坏');
      }
      const dataOffset = localOffset + 30
        + view.getUint16(localOffset + 26, true)
        + view.getUint16(localOffset + 28, true);
      if (dataOffset + compressedSize > bytes.byteLength) throw new Error('更新压缩包文件数据不完整');
      entries.push({
        name,
        method,
        uncompressedSize,
        compressed: bytes.slice(dataOffset, dataOffset + compressedSize),
        directory: name.endsWith('/')
      });
      offset = nameStart + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateEntry(entry) {
    if (entry.method === 0) return entry.compressed;
    if (entry.method !== 8) throw new Error(`不支持的 ZIP 压缩方式：${entry.method}`);
    const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.byteLength !== entry.uncompressedSize) throw new Error(`文件解压长度不符：${entry.name}`);
    return bytes;
  }

  function normalizeUpdateScopes(updateRule) {
    if (!Array.isArray(updateRule) || updateRule.length === 0 || (updateRule.length === 1 && updateRule[0] === true)) {
      return null;
    }
    const scopes = new Set(updateRule
      .filter((item) => typeof item === 'string')
      .map((item) => String(item || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase())
      .filter(Boolean));
    return scopes.size ? scopes : null;
  }

  function releaseAppliesToSelection(updateRule, selectedModules) {
    const scopes = normalizeUpdateScopes(updateRule);
    if (!scopes || scopes.has('main') || [...REQUIRED_MODULE_IDS].some((id) => scopes.has(id))) return true;
    if ([...scopes].some((id) => ROOT_COMPONENT_IDS.has(id))) return true;
    for (const id of selectedModules || []) {
      if (scopes.has(String(id || '').toLowerCase())) return true;
    }
    return false;
  }

  function normalizeZipFiles(entries) {
    const names = entries.map((entry) => entry.name).filter(Boolean);
    const rootName = names[0]?.split('/')[0] || '';
    const commonRoot = rootName && names.every((name) => name === rootName || name.startsWith(`${rootName}/`))
      ? `${rootName}/`
      : '';
    return entries.filter((entry) => !entry.directory).map((entry) => {
      const raw = commonRoot && entry.name.startsWith(commonRoot) ? entry.name.slice(commonRoot.length) : entry.name;
      const parts = raw.split('/').filter(Boolean);
      if (!parts.length || parts.some((part) => part === '.' || part === '..')) return null;
      return { entry, path: parts.join('/') };
    }).filter(Boolean);
  }

  function getArchiveComponent(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) {
      return parts[0].toLowerCase() === 'manifest.json'
        ? { id: 'manifest', module: false, manifest: true }
        : null;
    }
    const first = parts[0].toLowerCase();
    if (IGNORED_ARCHIVE_DIRECTORIES.has(first)) return null;
    if (first === 'modules') {
      const id = String(parts[1] || '').toLowerCase();
      return id ? { id, module: true, manifest: false } : null;
    }
    return { id: first, module: false, manifest: false };
  }

  function selectFiles(entries, updateRule) {
    const files = normalizeZipFiles(entries);
    const scopes = normalizeUpdateScopes(updateRule);
    return files.filter(({ path }) => {
      const component = getArchiveComponent(path);
      if (!component) return false;
      if (!component.module && !component.manifest && !ROOT_COMPONENT_IDS.has(component.id)) return false;
      if (!scopes || component.manifest) return true;
      if (component.module) return scopes.has(component.id);
      return scopes.has('main') || scopes.has(component.id);
    });
  }

  function filterFilesByModules(files, selectedModules) {
    return files.filter(({ path }) => {
      const match = String(path || '').match(/^modules\/([^/]+)\//i);
      if (!match || REQUIRED_MODULE_IDS.has(match[1].toLowerCase())) return true;
      const id = match[1].toLowerCase();
      return selectedModules.has(id);
    });
  }

  async function removeUnselectedModules(root, selectedModules) {
    let modulesDirectory;
    try {
      modulesDirectory = await root.getDirectoryHandle('modules');
    } catch {
      return;
    }
    for (const id of OPTIONAL_MODULE_IDS) {
      if (selectedModules.has(id)) continue;
      await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
  }

  async function cleanUpdateScopes(root, updateRule, selectedModules) {
    const scopes = normalizeUpdateScopes(updateRule);
    if (!scopes) {
      await clearDirectory(root);
      return;
    }
    if (scopes.has('main')) {
      const names = [];
      for await (const [name] of root.entries()) {
        if (name !== 'modules' && name !== 'manifest.json') names.push(name);
      }
      for (const name of names) {
        await globalThis.BjtuUpdateFileSystem.removeEntry(root, name, { recursive: true }).catch((error) => {
          if (error?.name !== 'NotFoundError') throw error;
        });
      }
    }
    for (const id of scopes) {
      if (!ROOT_COMPONENT_IDS.has(id)) continue;
      const directoryName = ROOT_COMPONENT_DIRECTORY_NAMES[id] || id;
      for (const candidate of new Set([directoryName, id])) {
        await globalThis.BjtuUpdateFileSystem.removeEntry(root, candidate, { recursive: true }).catch((error) => {
          if (error?.name !== 'NotFoundError') throw error;
        });
      }
    }
    let modulesDirectory = null;
    try {
      modulesDirectory = await root.getDirectoryHandle('modules');
    } catch {
      modulesDirectory = null;
    }
    if (!modulesDirectory) return;
    for (const id of MODULE_SCOPE_IDS) {
      if (!scopes.has(id)) continue;
      if (!REQUIRED_MODULE_IDS.has(id) && !selectedModules.has(id)) continue;
      await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
  }

  async function clearDirectory(root) {
    const names = [];
    for await (const [name] of root.entries()) names.push(name);
    for (const name of names) {
      try {
        await globalThis.BjtuUpdateFileSystem.removeEntry(root, name, { recursive: true });
      } catch (error) {
        throw new Error(`无法删除更新目录中的“${name}”：${String(error?.message || error)}`);
      }
    }
    const remaining = [];
    for await (const [name] of root.entries()) remaining.push(name);
    if (remaining.length) {
      throw new Error(`更新目录未完全清空，仍有：${remaining.join('、')}`);
    }
  }

  async function writeFile(root, path, bytes) {
    return globalThis.BjtuUpdateFileSystem.writeFile(root, path, bytes);
  }

  async function directoryFileExists(root, relativePath, expectedSize = 0) {
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!root || !parts.length) return false;
    try {
      let directory = root;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
      return expectedSize > 0 ? file.size === expectedSize : file.size > 0;
    } catch {
      return false;
    }
  }

  async function ensureCaptchaAssets(root, release) {
    const assets = globalThis.BjtuCaptchaAssets;
    if (!assets) throw new Error('验证码资源管理器未加载');
    await assets.ensureModel({
      onProgress: release ? ({ loaded, total }) => setStatus('installing-captcha-model', {
        version: release.version,
        name: release.name,
        loaded,
        total,
        directoryName: root.name
      }) : null
    });
    if (await directoryFileExists(root, assets.CORE_RELATIVE_PATH, assets.CORE_SIZE)) return 0;
    const bytes = await assets.downloadCore({
      onProgress: release ? ({ loaded, total }) => setStatus('installing-captcha-core', {
        version: release.version,
        name: release.name,
        loaded,
        total,
        directoryName: root.name
      }) : null
    });
    await writeFile(root, assets.CORE_RELATIVE_PATH, bytes);
    supplementalReloadRequired = true;
    return 1;
  }

  async function repairInstalledCaptchaAssets() {
    try {
      const moduleResponse = await fetch(chrome.runtime.getURL('modules/captcha/module.json'), { cache: 'no-store' });
      if (!moduleResponse.ok || !globalThis.BjtuCaptchaAssets) return false;
      await globalThis.BjtuCaptchaAssets.ensureModel();
      const root = await validateDirectory(await readDirectoryHandle());
      if (!root) return false;
      const written = await globalThis.BjtuUpdateFileSystem.withInstallLock(() => (
        ensureCaptchaAssets(root, null)
      ));
      if (written > 0) {
        chrome.runtime.reload();
        return true;
      }
    } catch (error) {
      console.info('[bjtu] captcha runtime asset repair deferred:', String(error?.message || error));
    }
    return false;
  }

  async function downloadArchive(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`);
      return await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  }

  async function installRelease(root, release) {
    supplementalReloadRequired = false;
    const archive = await retryNetworkOperation(() => downloadArchive(release.url), 2);
    return globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
      const entries = parseZipEntries(archive);
      const storedSelection = await chrome.storage.local.get(MODULE_SELECTION_KEY).catch(() => ({}));
      const selectedModules = new Set(Array.isArray(storedSelection?.[MODULE_SELECTION_KEY])
        ? storedSelection[MODULE_SELECTION_KEY]
        : OPTIONAL_MODULE_IDS);
      REQUIRED_MODULE_IDS.forEach((id) => selectedModules.add(id));
      const selectedArchiveFiles = selectFiles(entries, release.update);
      if (!selectedArchiveFiles.length) throw new Error('更新压缩包中没有需要写入的文件');
      const files = filterFilesByModules(selectedArchiveFiles, selectedModules);
      if (selectedModules.has('captcha')) {
        await globalThis.BjtuCaptchaAssets?.ensureModel();
      }
      if (release.clean) {
        await cleanUpdateScopes(root, release.update, selectedModules);
      } else if (!normalizeUpdateScopes(release.update)) {
        await removeUnselectedModules(root, selectedModules);
      }
      let completed = 0;
      for (const batch of Array.from({ length: Math.ceil(files.length / 8) }, (_, index) => files.slice(index * 8, index * 8 + 8))) {
        await Promise.all(batch.map(async ({ entry, path }) => {
          await writeFile(root, path, await inflateEntry(entry));
          completed += 1;
          await setStatus('installing', {
            version: release.version,
            name: release.name,
            completed,
            total: files.length,
            directoryName: root.name
          });
        }));
      }
      const supplementalWrites = selectedModules.has('captcha')
        ? await ensureCaptchaAssets(root, release)
        : 0;
      return files.length + supplementalWrites;
    });
  }

  async function runBackgroundUpdate({ forceCheck = false, suppressRecentReloadRetry = false } = {}) {
    if (runningPromise) return runningPromise;
    runningPromise = (async () => {
      const stored = await chrome.storage.local.get([
        ENABLED_KEY, INSTALL_OPTIONAL_KEY, APPLIED_WITHOUT_RELOAD_KEY, PENDING_RELOAD_KEY,
        DETECTED_NOTIFICATION_VERSION_KEY
      ]);
      const updaterEnabled = stored?.[ENABLED_KEY] === undefined ? true : stored?.[ENABLED_KEY] === true;
      if (!forceCheck && !updaterEnabled) return { skipped: true };
      const manifestVersion = String(chrome.runtime.getManifest().version || '0');
      const appliedVersion = String(stored?.[APPLIED_WITHOUT_RELOAD_KEY]?.ver || '');
      const localVersion = compareVersions(appliedVersion, manifestVersion) > 0 ? appliedVersion : manifestVersion;
      const pendingReloadVersion = String(stored?.[PENDING_RELOAD_KEY]?.ver || '');
      const lastReloadRequestAt = Number(stored?.[PENDING_RELOAD_KEY]?.autoReloadRequestedAt || 0);
      const staleReloadRecentlyRequested = pendingReloadVersion
        && compareVersions(pendingReloadVersion, localVersion) > 0
        && lastReloadRequestAt > 0
        && Date.now() - lastReloadRequestAt < STALE_RELOAD_RETRY_COOLDOWN_MS;
      if (!forceCheck && suppressRecentReloadRetry && staleReloadRecentlyRequested) {
        await setStatus('reload-cooldown', {
          localVersion,
          version: pendingReloadVersion,
          retryAfter: lastReloadRequestAt + STALE_RELOAD_RETRY_COOLDOWN_MS
        });
        return { updated: false, reloadCooldown: true };
      }
      await setStatus('checking', { localVersion });
      const release = await fetchLatestRelease();
      if (compareVersions(release.version, localVersion) <= 0) {
        await setStatus('latest', { localVersion, version: release.version, name: release.name });
        return { updated: false, release };
      }
      const retryingStaleInstallation = normalizeVersion(stored?.[PENDING_RELOAD_KEY]?.ver)
        === normalizeVersion(release.version);
      const installOptionalUpdate = stored?.[INSTALL_OPTIONAL_KEY] === true || retryingStaleInstallation;
      const storedSelection = await chrome.storage.local.get(MODULE_SELECTION_KEY).catch(() => ({}));
      const selectedModules = new Set(Array.isArray(storedSelection?.[MODULE_SELECTION_KEY])
        ? storedSelection[MODULE_SELECTION_KEY]
        : OPTIONAL_MODULE_IDS);
      REQUIRED_MODULE_IDS.forEach((id) => selectedModules.add(id));
      if (!releaseAppliesToSelection(release.update, selectedModules)) {
        const record = {
          ver: release.version,
          name: release.name,
          fileCount: 0,
          force: release.force,
          reload: false,
          skippedByModuleSelection: true,
          appliedAt: Date.now(),
          background: true
        };
        await chrome.storage.local.set({
          [APPLIED_WITHOUT_RELOAD_KEY]: record,
          [PENDING_RELOAD_KEY]: null,
          [STATUS_KEY]: { status: 'latest', localVersion: release.version, version: release.version, name: release.name, skippedByModuleSelection: true, checkedAt: Date.now() }
        });
        return { updated: false, skippedByModuleSelection: true, release };
      }
      await notifyUpdateDetected(release, stored?.[DETECTED_NOTIFICATION_VERSION_KEY], installOptionalUpdate);
      if (!release.force && stored?.[INSTALL_OPTIONAL_KEY] !== true && !retryingStaleInstallation) {
        await setStatus('optional-update-available', {
          localVersion,
          version: release.version,
          name: release.name,
          force: false
        });
        return { updated: false, optionalUpdateAvailable: true, release };
      }
      const directoryHandle = await readDirectoryHandle();
      const root = await validateDirectory(directoryHandle);
      if (!root) {
        await notifyUpdateIssue(
          'permission',
          directoryHandle
            ? '扩展安装目录没有写入权限，请在全屏页面重新选择并授权目录。'
            : '尚未授权扩展安装目录，请先在全屏页面手动更新一次并选择目录。',
          release.version
        );
        await setStatus('directory-required', {
          localVersion,
          version: release.version,
          name: release.name,
          force: release.force
        });
        return { updated: false, directoryRequired: true, release };
      }
      await clearUpdateIssueNotificationState('permission');
      await setStatus('downloading', {
        localVersion,
        version: release.version,
        name: release.name,
        directoryName: root.name
      });
      const fileCount = await installRelease(root, release);
      const reloadRequired = release.reload || supplementalReloadRequired;
      const record = {
        ver: release.version,
        name: release.name,
        fileCount,
        force: release.force,
        reload: reloadRequired,
        appliedAt: Date.now(),
        background: true
      };
      if (!reloadRequired) {
        await chrome.storage.local.set({
          [APPLIED_WITHOUT_RELOAD_KEY]: record,
          [PENDING_RELOAD_KEY]: null,
          [STATUS_KEY]: { status: 'complete', ...record, checkedAt: Date.now(), directoryName: root.name }
        });
        await notifyUpdateComplete(
          release,
          `已更新到 ${release.name}，刷新已打开的扩展页面后生效。`
        ).catch(() => {});
        return { updated: true, reloaded: false, release, fileCount };
      }
      const appUrl = chrome.runtime.getURL('app/app.html');
      const appWasOpen = (await chrome.tabs.query({})).some((tab) => String(tab?.url || '').startsWith(appUrl));
      const completionNotificationId = await notifyUpdateComplete(
        release,
        `已更新到 ${release.name}，正在自动重新加载扩展。`
      ).catch(() => `${COMPLETE_NOTIFICATION_PREFIX}${normalizeVersion(release.version) || 'unknown'}`);
      await chrome.storage.local.set({
        [PENDING_RELOAD_KEY]: { ...record, autoReloadRequestedAt: Date.now() },
        [RELOAD_HANDOFF_KEY]: {
          ...record,
          requestedAt: Date.now(),
          reopenApp: appWasOpen,
          completionNotificationId
        },
        [STATUS_KEY]: { status: 'reloading', ...record, checkedAt: Date.now(), directoryName: root.name }
      });
      chrome.runtime.reload();
      return { updated: true, reloaded: true, release, fileCount };
    })().catch(async (error) => {
      const staleDirectoryState = globalThis.BjtuUpdateFileSystem.isInvalidStateError(error);
      if (staleDirectoryState) await clearStoredDirectoryHandle().catch(() => {});
      const normalizedError = staleDirectoryState
        ? new Error('更新期间目录或文件被其他程序修改，请在全屏页面重新选择扩展安装目录。')
        : error;
      const category = staleDirectoryState ? 'permission' : classifyUpdateIssue(normalizedError);
      if (category === 'permission') {
        await notifyUpdateIssue('permission', String(normalizedError?.message || normalizedError), '').catch(() => {});
      }
      await setStatus('error', { error: String(normalizedError?.message || normalizedError) }).catch(() => {});
      throw normalizedError;
    }).finally(() => {
      runningPromise = null;
    });
    return runningPromise;
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([INTERVAL_KEY]).catch(() => ({}));
    const interval = normalizeIntervalMinutes(stored?.[INTERVAL_KEY]);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);
    if (existing && Number(existing.periodInMinutes || 0) === interval) return existing;
    if (existing) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: interval, periodInMinutes: interval });
    return chrome.alarms.get(ALARM_NAME).catch(() => null);
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM_NAME) runBackgroundUpdate().catch(() => {});
  });
  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm().then(() => runBackgroundUpdate({ suppressRecentReloadRetry: true })).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm().then(() => runBackgroundUpdate({ suppressRecentReloadRetry: true })).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes[ENABLED_KEY] && !changes[INSTALL_OPTIONAL_KEY] && !changes[INTERVAL_KEY])) return;
    void ensureAlarm();
    if (changes[ENABLED_KEY]?.newValue === true || changes[INSTALL_OPTIONAL_KEY]?.newValue === true) {
      runBackgroundUpdate().catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'BACKGROUND_UPDATE_CHECK_NOW') return false;
    runBackgroundUpdate({ forceCheck: true })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  });
  void repairInstalledCaptchaAssets();
  void ensureAlarm();
})();
