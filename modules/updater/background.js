(function () {
  'use strict';

  const ENABLED_KEY = 'backgroundAutoUpdateEnabled';
  const INSTALL_OPTIONAL_KEY = 'backgroundAutoInstallOptionalEnabled';
  const INSTALL_FORCED_KEY = 'backgroundAutoInstallForcedEnabled';
  const INTERVAL_KEY = 'backgroundAutoUpdateIntervalMinutes';
  const FOREGROUND_PROMPT_KEY = 'updateForegroundPromptMode';
  const DEFAULT_INTERVAL_MINUTES = 5;
  const STATUS_KEY = 'backgroundAutoUpdateStatus';
  const DETECTED_NOTIFICATION_VERSION_KEY = 'backgroundUpdateDetectedNotifiedVersion';
  const INSTALLED_RELEASE_DESCRIPTION_KEY = 'installedReleaseDescription';
  const ISSUE_NOTIFICATIONS_KEY = 'backgroundUpdateIssueNotifications';
  const ALARM_NAME = 'bjtu-background-update-check';
  const DETECTED_NOTIFICATION_PREFIX = 'bjtu-background-update-detected:';
  const COMPLETE_NOTIFICATION_PREFIX = 'bjtu-background-update-complete:';
  const ISSUE_NOTIFICATION_PREFIX = 'bjtu-background-update-issue:';
  const SOURCE_URLS = [
    'https://s1y4x1.github.io/release.json'
  ];
  const APPLIED_WITHOUT_RELOAD_KEY = 'appliedUpdateWithoutReload';
  const PENDING_RELOAD_KEY = 'pendingUpdateReload';
  const RELOAD_HANDOFF_KEY = 'versionAutoReloadHandoff';
  const MODULE_SELECTION_KEY = 'updateModuleSelection';
  const MODULE_KNOWN_IDS_KEY = 'updateModuleKnownIds';
  const MODULE_KNOWN_IDS_INITIALIZED_KEY = 'updateModuleKnownIdsInitialized';
  const REQUIRED_MODULE_IDS = new Set(['ve', 'updater']);
  const IGNORED_ARCHIVE_DIRECTORIES = new Set(['.agents', '.git', '.github', '.mimocode']);
  const STALE_RELOAD_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
  const FOREGROUND_PAGE_PATHS = new Set([
    'app/app.html',
    'popup/popup.html',
    'options/options.html'
  ]);
  let runningPromise = null;
  let manualInstallPromise = null;
  const manualModuleSelectionRequests = new Map();

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

  function isForegroundExtensionUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''));
      if (url.origin !== new URL(chrome.runtime.getURL('/')).origin) return false;
      return FOREGROUND_PAGE_PATHS.has(url.pathname.replace(/^\/+/, ''));
    } catch {
      return false;
    }
  }

  async function hasOpenForegroundPage() {
    if (typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({}).catch(() => []);
      if (contexts.some((context) => isForegroundExtensionUrl(context?.documentUrl))) return true;
    }
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.some((tab) => isForegroundExtensionUrl(tab?.url));
  }

  async function focusUpdateApp() {
    const appUrl = chrome.runtime.getURL('app/app.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => String(tab.url || '').split(/[?#]/, 1)[0] === appUrl);
    const opened = existing
      ? await chrome.tabs.update(existing.id, { active: true })
      : await globalThis.BjtuTabs.create({ url: appUrl, active: true });
    const window = await chrome.windows.get(opened.windowId);
    await chrome.windows.update(opened.windowId, {
      ...(window.state === 'minimized' ? { state: 'normal' } : {}),
      focused: true
    });
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

  function splitReleaseDescription(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1));
  }

  function diffReleaseDescriptions(previousValue, nextValue) {
    const previous = splitReleaseDescription(previousValue);
    const next = splitReleaseDescription(nextValue);
    if (!previous.length) return next.join('\n').trim();
    if (!next.length) return '';
    const rows = previous.length + 1;
    const columns = next.length + 1;
    const lcs = Array.from({ length: rows }, () => new Uint16Array(columns));
    for (let left = previous.length - 1; left >= 0; left -= 1) {
      for (let right = next.length - 1; right >= 0; right -= 1) {
        lcs[left][right] = previous[left] === next[right]
          ? lcs[left + 1][right + 1] + 1
          : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
      }
    }
    const changes = [];
    let left = 0;
    let right = 0;
    while (left < previous.length || right < next.length) {
      if (left < previous.length && right < next.length && previous[left] === next[right]) {
        left += 1;
        right += 1;
      } else if (right < next.length && (left >= previous.length || lcs[left][right + 1] >= lcs[left + 1][right])) {
        changes.push(`+ ${next[right]}`);
        right += 1;
      } else {
        changes.push(`- ${previous[left]}`);
        left += 1;
      }
    }
    return changes.join('\n').trim();
  }

  function buildDetectedNotificationMessage(release, previousDescription) {
    const description = String(release?.description || '').trim();
    if (!description) return '暂无更新说明。';
    const previous = String(previousDescription || '').trim();
    const diff = diffReleaseDescriptions(previous, description);
    const message = previous
      ? (diff || '更新说明与当前版本相同。')
      : description;
    return message.length > 1800 ? `${message.slice(0, 1799)}…` : message;
  }

  function notificationVersion(release) {
    const version = String(release?.version || '').trim();
    return release?.hasName ? `${release.name} (${version})` : (version || '新版本');
  }

  async function notifyUpdateDetected(release, lastNotifiedVersion = '', installUpdate = false, previousDescription = '') {
    if (normalizeVersion(lastNotifiedVersion) === normalizeVersion(release?.version)) return false;
    try {
      const notificationId = `${DETECTED_NOTIFICATION_PREFIX}${normalizeVersion(release?.version) || 'unknown'}`;
      const titlePrefix = installUpdate
        ? (release?.force ? '正在更新：' : '安装非强制更新：') : '发现新版本：';
      const titleVersion = notificationVersion(release);
      await createSystemNotification(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `${titlePrefix}${titleVersion}`,
        message: buildDetectedNotificationMessage(release, previousDescription),
        ...(!installUpdate
          ? { buttons: [{ title: '安装' }, { title: '忽略' }] } : {}),
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
      message: String(message || `已更新到 ${notificationVersion(release)}。`),
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
        hasName: !!String(data?.name || '').trim(),
        description: String(data?.desc || '').trim(),
        url: new URL(url).href,
        reload: data?.reload !== false,
        force: data?.force === true,
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

  async function readDirectoryHandle() {
    return globalThis.BjtuUpdateFileSystem.readDirectoryHandle();
  }

  async function clearStoredDirectoryHandle() {
    await globalThis.BjtuUpdateFileSystem.storeDirectoryHandle(null);
  }

  async function verifyBackgroundDirectoryWriteAccess(expectedForegroundProbe) {
    const root = await readDirectoryHandle();
    const validRoot = await validateDirectory(root);
    if (!validRoot) throw new Error('后台没有扩展目录的读写权限');
    const updaterDirectory = await (await validRoot.getDirectoryHandle('modules')).getDirectoryHandle('updater');
    const foregroundMarker = await updaterDirectory.getFileHandle('directory-permission.json');
    const foregroundProbe = await (await foregroundMarker.getFile()).text();
    if (!expectedForegroundProbe || foregroundProbe !== expectedForegroundProbe) {
      throw new Error('后台访问的扩展目录与前台验证的目录不一致');
    }
    const marker = await updaterDirectory.getFileHandle('directory-permission-background.json', { create: true });
    const probeId = crypto.randomUUID();
    let content = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      content = JSON.stringify({ format: 'bjtu-ca-background-directory-permission', probeId, attempt, checkedAt: Date.now() });
      const writer = await marker.createWritable();
      await writer.write(content);
      await writer.close();
      if (await (await marker.getFile()).text() !== content) {
        throw new Error(`后台第 ${attempt} 次写入后读取不一致`);
      }
    }
    return content;
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

  function parseZipEntries(source) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
        compressed: bytes.subarray(dataOffset, dataOffset + compressedSize),
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
      const id = parts[0].toLowerCase();
      return id === 'manifest.json'
        ? { id: 'manifest', module: false, manifest: true }
        : { id, module: false, manifest: false };
    }
    const first = parts[0].toLowerCase();
    if (IGNORED_ARCHIVE_DIRECTORIES.has(first)) return null;
    if (first === 'modules') {
      const id = String(parts[1] || '').toLowerCase();
      return id ? { id, module: true, manifest: false } : null;
    }
    return { id: first, module: false, manifest: false };
  }

  function selectFiles(files) {
    return files.filter(({ path }) => getArchiveComponent(path));
  }

  function getArchiveModuleIds(files) {
    return [...new Set((files || []).map(({ path }) => {
      const match = String(path || '').match(/^modules\/([^/]+)\//i);
      return String(match?.[1] || '').toLowerCase();
    }).filter((id) => id && !REQUIRED_MODULE_IDS.has(id)))];
  }

  async function getArchiveModuleLabels(files) {
    const labels = {};
    const moduleJsonFiles = (files || []).filter(({ path }) => /^modules\/[^/]+\/module\.json$/i.test(String(path || '')));
    for (const item of moduleJsonFiles) {
      const match = String(item.path || '').match(/^modules\/([^/]+)\/module\.json$/i);
      const id = String(match?.[1] || '').toLowerCase();
      if (!id) continue;
      try {
        const data = JSON.parse(new TextDecoder('utf-8').decode(await inflateEntry(item.entry)));
        const name = String(data?.name || data?.label || '').trim();
        if (name) labels[id] = name;
      } catch {}
    }
    return labels;
  }

  function getArchiveModuleSize(files, moduleId) {
    const prefix = `modules/${String(moduleId || '').toLowerCase()}/`;
    return (files || []).reduce((total, item) => (
      String(item?.path || '').toLowerCase().startsWith(prefix)
        ? total + Math.max(0, Number(item?.entry?.uncompressedSize) || 0)
        : total
    ), 0);
  }

  async function requestManualModuleSelection({ release, root, archiveFiles, candidates, initial }) {
    const requestId = crypto.randomUUID();
    const labels = await getArchiveModuleLabels(archiveFiles);
    const choices = [
      {
        id: 've',
        name: labels.ve || '智慧课程平台',
        moduleSize: getArchiveModuleSize(archiveFiles, 've'),
        checked: true,
        disabled: true
      },
      {
        id: 'updater',
        name: labels.updater || '更新组件',
        moduleSize: getArchiveModuleSize(archiveFiles, 'updater'),
        checked: true,
        disabled: true
      },
      ...candidates.map((id) => ({
        id,
        name: labels[id] || id,
        moduleSize: getArchiveModuleSize(archiveFiles, id),
        checked: initial.has(id),
        disabled: false
      }))
    ];
    const selectionPromise = new Promise((resolve, reject) => {
      manualModuleSelectionRequests.set(requestId, {
        allowed: new Set(candidates),
        resolve,
        reject
      });
    });
    try {
      await setStatus('selecting-modules', {
        manual: true,
        requestId,
        ownerId: release.ownerId,
        version: release.version,
        name: release.name,
        directoryName: root.name,
        choices
      });
    } catch (error) {
      manualModuleSelectionRequests.delete(requestId);
      throw error;
    }
    return selectionPromise;
  }

  function resolveManualModuleSelection(payload) {
    const requestId = String(payload?.requestId || '');
    const pending = manualModuleSelectionRequests.get(requestId);
    if (!pending) return false;
    manualModuleSelectionRequests.delete(requestId);
    if (payload?.cancelled === true) {
      pending.reject(new Error(String(payload?.error || '已取消模块选择')));
      return true;
    }
    const selected = new Set((Array.isArray(payload?.selected) ? payload.selected : [])
      .map((id) => String(id || '').toLowerCase())
      .filter((id) => pending.allowed.has(id)));
    pending.resolve(selected);
    return true;
  }

  async function getInstalledOptionalModuleIds(root) {
    const installed = [];
    let modulesDirectory;
    try {
      modulesDirectory = await root.getDirectoryHandle('modules');
    } catch {
      return installed;
    }
    for await (const [name, handle] of modulesDirectory.entries()) {
      const id = String(name || '').toLowerCase();
      if (handle?.kind === 'directory' && id && !REQUIRED_MODULE_IDS.has(id)) installed.push(id);
    }
    return installed;
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
    for (const id of await getInstalledOptionalModuleIds(root)) {
      if (selectedModules.has(id)) continue;
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
    return globalThis.BjtuUpdateFileSystem.writeFileIfChanged(root, path, bytes);
  }

  async function downloadArchive(url, progress = null, version = '') {
    const cached = await globalThis.BjtuUpdateFileSystem.readArchive(url, version);
    if (cached) return cached;
    const bytes = await downloadArchiveFromNetwork(url, progress);
    parseZipEntries(bytes);
    await globalThis.BjtuUpdateFileSystem.storeArchive(url, version, bytes);
    return bytes;
  }

  async function downloadArchiveFromNetwork(url, progress = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`);
      if (!response.body?.getReader) return await response.arrayBuffer();
      const total = Math.max(0, Number(response.headers.get('content-length') || 0));
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      let lastReportedAt = 0;
      const startedAt = performance.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        chunks.push(value);
        received += value.byteLength;
        const now = performance.now();
        if (typeof progress === 'function' && (now - lastReportedAt >= 150 || (total > 0 && received >= total))) {
          lastReportedAt = now;
          await progress({
            loaded: received,
            total,
            speed: received / Math.max(0.001, (now - startedAt) / 1000),
            percent: total > 0 ? Math.min(100, received * 100 / total) : null
          });
        }
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer;
    } finally {
      clearTimeout(timer);
    }
  }

  async function applyMetadataOnlyRelease(root, release, archive) {
    if (!root) return false;
    return globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
      const archiveFiles = selectFiles(normalizeZipFiles(parseZipEntries(archive)));
      if (!archiveFiles.some(({ path }) => path === 'manifest.json')) throw new Error('更新包缺少 manifest.json');
      const installed = await getInstalledOptionalModuleIds(root);
      const inventory = await chrome.storage.local.get([MODULE_KNOWN_IDS_KEY, MODULE_KNOWN_IDS_INITIALIZED_KEY]);
      const known = new Set(inventory[MODULE_KNOWN_IDS_INITIALIZED_KEY] === true
        ? inventory[MODULE_KNOWN_IDS_KEY] || [] : installed);
      installed.forEach((id) => known.add(id));
      // A newly introduced module is selected by default and requires the normal update flow.
      if (getArchiveModuleIds(archiveFiles).some((id) => !known.has(id))) return false;
      const files = filterFilesByModules(archiveFiles, new Set(installed));
      let localManifest;
      const fileMatches = async ({ entry, path }) => {
        if (path === 'release.json') return true;
        let directory = root;
        const parts = path.split('/');
        let file;
        try {
          for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
          file = await (await directory.getFileHandle(parts.at(-1))).getFile();
        } catch (error) {
          if (error?.name === 'NotFoundError') return false;
          throw error;
        }
        const bytes = await inflateEntry(entry);
        if (path === 'manifest.json') {
          localManifest = JSON.parse(await file.text());
          const incoming = JSON.parse(new TextDecoder().decode(bytes));
          const current = { ...localManifest };
          delete incoming.version;
          delete incoming.version_name;
          delete current.version;
          delete current.version_name;
          const canonical = (value) => JSON.stringify(value, function (_key, item) {
            return item && typeof item === 'object' && !Array.isArray(item)
              ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
          });
          if (canonical(current) !== canonical(incoming)) return false;
        } else if (!await globalThis.BjtuUpdateFileSystem.fileMatchesBytes(file, bytes)) return false;
        return true;
      };
      let nextFile = 0;
      let changed = false;
      const concurrency = await globalThis.BjtuUpdateFileSystem.readFileConcurrency();
      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
        while (!changed && nextFile < files.length) {
          const item = files[nextFile++];
          if (!await fileMatches(item)) changed = true;
        }
      }));
      if (changed) return false;
      const incomingManifest = archiveFiles.find(({ path }) => path === 'manifest.json');
      const metadata = JSON.parse(new TextDecoder().decode(globalThis.BjtuUpdateFileSystem.applyReleaseVersionName(
        await inflateEntry(incomingManifest.entry), release
      )));
      localManifest.version = metadata.version;
      if (metadata.version_name !== undefined) localManifest.version_name = metadata.version_name;
      else delete localManifest.version_name;
      await writeFile(root, 'manifest.json', new TextEncoder().encode(`${JSON.stringify(localManifest, null, 2)}\n`));
      const record = {
        ver: release.version, name: release.name, description: release.description,
        reload: false, fileCount: 1, appliedAt: Date.now(), background: true
      };
      await chrome.storage.local.set({
        [APPLIED_WITHOUT_RELOAD_KEY]: record,
        [PENDING_RELOAD_KEY]: null,
        [INSTALLED_RELEASE_DESCRIPTION_KEY]: { version: release.version, desc: release.description, updatedAt: Date.now() }
      });
      await setStatus('complete', { ...record, metadataOnly: true });
      return true;
    });
  }

  async function installRelease(root, release, { manual = false } = {}) {
    const archive = await retryNetworkOperation(() => downloadArchive(release.url, manual
      ? (transfer) => setStatus('downloading', {
          manual: true,
          version: release.version,
          name: release.name,
          directoryName: root.name,
          ...transfer
        })
      : null, release.version), 2);
    return globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
      const entries = parseZipEntries(archive);
      const archiveFiles = normalizeZipFiles(entries);
      Object.assign(release, await globalThis.BjtuUpdateFileSystem.readArchiveRelease(archiveFiles, inflateEntry, release));
      const packagedModuleIds = getArchiveModuleIds(archiveFiles);
      const storedKnownModules = await chrome.storage.local.get([
        MODULE_KNOWN_IDS_KEY,
        MODULE_KNOWN_IDS_INITIALIZED_KEY
      ]).catch(() => ({}));
      const previousKnown = storedKnownModules?.[MODULE_KNOWN_IDS_KEY];
      const knownIdsInitialized = storedKnownModules?.[MODULE_KNOWN_IDS_INITIALIZED_KEY] === true;
      const installedModuleIds = await getInstalledOptionalModuleIds(root);
      // On the first inventory pass, archive-only modules are new and should
      // be selected automatically. Once initialized, the remembered list
      // still prevents a module the user removed from being reselected.
      const knownModules = new Set(knownIdsInitialized && Array.isArray(previousKnown) ? previousKnown : installedModuleIds);
      installedModuleIds.forEach((id) => knownModules.add(id));
      const newModules = packagedModuleIds.filter((id) => !knownModules.has(id));
      const candidates = [...new Set([...installedModuleIds, ...packagedModuleIds])]
        .filter((id) => !REQUIRED_MODULE_IDS.has(id));
      const initial = new Set(candidates.filter((id) => installedModuleIds.includes(id) || newModules.includes(id)));
      const chosenModules = manual
        ? await requestManualModuleSelection({ release, root, archiveFiles, candidates, initial })
        : new Set(initial);
      const selectedModules = globalThis.BjtuModuleRegistry.withDependencies(chosenModules);
      globalThis.BjtuModuleRegistry.assertDependencies(selectedModules, [
        ...packagedModuleIds, ...(release.clean ? [] : installedModuleIds)
      ]);
      REQUIRED_MODULE_IDS.forEach((id) => selectedModules.add(id));
      const selectedArchiveFiles = selectFiles(archiveFiles);
      if (!selectedArchiveFiles.length) throw new Error('更新压缩包中没有需要写入的文件');
      const files = filterFilesByModules(selectedArchiveFiles, selectedModules);
      if (manual) {
        await setStatus('installing', {
          manual: true,
          version: release.version,
          name: release.name,
          completed: 0,
          total: files.length,
          directoryName: root.name
        });
      }
      if (release.clean) {
        await clearDirectory(root);
      } else {
        await removeUnselectedModules(root, selectedModules);
      }
      let completed = 0;
      let writtenCount = 0;
      const concurrency = Math.max(1, Math.min(await globalThis.BjtuUpdateFileSystem.readFileConcurrency(), files.length));
      for (const batch of Array.from(
        { length: Math.ceil(files.length / concurrency) },
        (_, index) => files.slice(index * concurrency, index * concurrency + concurrency)
      )) {
        await Promise.all(batch.map(async ({ entry, path }) => {
          let bytes = await inflateEntry(entry);
          if (path === 'manifest.json') bytes = globalThis.BjtuUpdateFileSystem.applyReleaseVersionName(bytes, release);
          if (await writeFile(root, path, bytes)) writtenCount += 1;
          completed += 1;
        }));
        await setStatus('installing', {
          manual,
          version: release.version,
          name: release.name,
          completed,
          total: files.length,
          directoryName: root.name
        });
      }
      packagedModuleIds.forEach((id) => knownModules.add(id));
      await chrome.storage.local.set({
        [MODULE_SELECTION_KEY]: [...selectedModules].filter((id) => !REQUIRED_MODULE_IDS.has(id)),
        [MODULE_KNOWN_IDS_KEY]: [...knownModules],
        [MODULE_KNOWN_IDS_INITIALIZED_KEY]: true
      });
      return writtenCount;
    });
  }

  function normalizeManualRelease(payload) {
    const url = String(payload?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('更新下载地址无效');
    const version = payload?.commit ? '' : String(payload?.version || chrome.runtime.getManifest().version || '').trim();
    return {
      version,
      commit: payload?.commit,
      name: String(payload?.name || version).trim() || version,
      description: String(payload?.description || ''),
      url,
      reload: payload?.reload !== false,
      force: payload?.force === true,
      ownerId: String(payload?.ownerId || ''),
      clean: true
    };
  }

  async function runManualCleanInstall(payload, sender) {
    if (manualInstallPromise) return manualInstallPromise;
    manualInstallPromise = (async () => {
      const release = normalizeManualRelease(payload);
      const directoryHandle = await readDirectoryHandle();
      const root = await validateDirectory(directoryHandle);
      if (!root) throw new Error('尚未授权扩展安装目录，或目录写入权限已失效');
      await setStatus('downloading', {
        manual: true,
        version: release.version,
        name: release.name,
        directoryName: root.name,
        loaded: 0,
        total: 0,
        percent: null
      });
      const fileCount = await installRelease(root, release, { manual: true });
      const record = {
        ver: release.version,
        name: release.name,
        description: release.description,
        fileCount,
        force: release.force,
        reload: release.reload,
        clean: true,
        appliedAt: Date.now(),
        background: true,
        manual: true
      };
      await chrome.storage.local.set({
        [INSTALLED_RELEASE_DESCRIPTION_KEY]: {
          version: release.version,
          desc: release.description,
          updatedAt: Date.now()
        }
      });
      if (!release.reload) {
        await chrome.storage.local.set({
          [APPLIED_WITHOUT_RELOAD_KEY]: record,
          [PENDING_RELOAD_KEY]: null,
          [STATUS_KEY]: {
            status: 'complete',
            ...record,
            directoryName: root.name,
            checkedAt: Date.now()
          }
        });
        return { updated: true, reloaded: false, fileCount, release };
      }

      const sourceUrl = String(sender?.url || sender?.tab?.url || '');
      let restoreOptionsPath = '';
      try {
        const sourcePath = new URL(sourceUrl).pathname.replace(/^\/+/, '');
        if (sourcePath === 'options/options.html') restoreOptionsPath = sourcePath;
      } catch {}
      await chrome.storage.local.set({
        [PENDING_RELOAD_KEY]: { ...record, autoReloadRequestedAt: Date.now() },
        [STATUS_KEY]: {
          status: 'reloading',
          ...record,
          directoryName: root.name,
          checkedAt: Date.now()
        }
      });
      await globalThis.BjtuForegroundAppPages?.prepareReload?.({
        ...record,
        reopenApp: false,
        restoreOptionsPath
      }, sender?.tab?.id).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 150));
      chrome.runtime.reload();
      return { updated: true, reloaded: true, fileCount, release };
    })().catch(async (error) => {
      const staleDirectoryState = globalThis.BjtuUpdateFileSystem.isInvalidStateError(error);
      if (staleDirectoryState) await clearStoredDirectoryHandle().catch(() => {});
      const normalizedError = staleDirectoryState
        ? new Error('更新期间目录或文件被其他程序修改，请重新选择扩展安装目录。')
        : error;
      await setStatus('error', {
        manual: true,
        error: String(normalizedError?.message || normalizedError)
      }).catch(() => {});
      throw normalizedError;
    }).finally(() => {
      manualInstallPromise = null;
    });
    return manualInstallPromise;
  }

  async function runBackgroundUpdate({ forceCheck = false, suppressRecentReloadRetry = false, installVersion = '' } = {}) {
    if (runningPromise) return runningPromise;
    runningPromise = (async () => {
      const stored = await chrome.storage.local.get([
        ENABLED_KEY, INSTALL_OPTIONAL_KEY, INSTALL_FORCED_KEY, APPLIED_WITHOUT_RELOAD_KEY, PENDING_RELOAD_KEY,
        DETECTED_NOTIFICATION_VERSION_KEY, INSTALLED_RELEASE_DESCRIPTION_KEY,
        'ignoredUpdateVersion', FOREGROUND_PROMPT_KEY
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
      const installRequested = !!installVersion && normalizeVersion(installVersion) === normalizeVersion(release.version);
      if (compareVersions(release.version, localVersion) <= 0) {
        if (compareVersions(release.version, localVersion) === 0) {
          await chrome.storage.local.set({
            [INSTALLED_RELEASE_DESCRIPTION_KEY]: {
              version: release.version,
              desc: release.description,
              updatedAt: Date.now()
            }
          });
        }
        await setStatus('latest', { localVersion, version: release.version, name: release.name });
        return { updated: false, release };
      }
      const archive = await retryNetworkOperation(() => downloadArchive(release.url, null, release.version), 2);
      const directoryHandle = await readDirectoryHandle();
      const root = await validateDirectory(directoryHandle);
      if (await applyMetadataOnlyRelease(root, release, archive)) {
        return { updated: true, reloaded: false, metadataOnly: true, release };
      }
      const autoInstallForced = (await chrome.storage.local.get(INSTALL_FORCED_KEY))[INSTALL_FORCED_KEY] !== false;
      const autoInstallEnabled = release.force ? autoInstallForced : stored[INSTALL_OPTIONAL_KEY] === true;
      if (!installRequested && !autoInstallEnabled
        && normalizeVersion(stored.ignoredUpdateVersion) === normalizeVersion(release.version)) {
        return { updated: false, ignored: true, release };
      }
      if (!installRequested && await hasOpenForegroundPage()) {
        const promptMode = ['immediate', 'active', 'silent'].includes(stored[FOREGROUND_PROMPT_KEY])
          ? stored[FOREGROUND_PROMPT_KEY] : 'active';
        if (promptMode === 'immediate') await focusUpdateApp();
        await setStatus('foreground-active', {
          localVersion,
          version: release.version,
          name: release.name,
          force: release.force,
          foregroundPromptMode: promptMode
        });
        if (promptMode !== 'silent') {
          await chrome.runtime.sendMessage({
            type: 'BJTU_UPDATER_OPEN_VERSION_NOTICE', version: release.version
          }).catch(() => {});
        }
        return { updated: false, foregroundActive: true, release };
      }
      const retryingStaleInstallation = normalizeVersion(stored?.[PENDING_RELOAD_KEY]?.ver)
        === normalizeVersion(release.version);
      const installUpdate = installRequested || autoInstallEnabled || (!release.force && retryingStaleInstallation);
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
      const installedDescription = stored?.[INSTALLED_RELEASE_DESCRIPTION_KEY];
      const previousDescription = installedDescription
        && normalizeVersion(installedDescription.version) === normalizeVersion(localVersion)
        ? String(installedDescription.desc || '')
        : '';
      await notifyUpdateDetected(
        release,
        stored?.[DETECTED_NOTIFICATION_VERSION_KEY],
        installUpdate,
        previousDescription
      );
      if (!installUpdate) {
        await setStatus('optional-update-available', {
          localVersion,
          version: release.version,
          name: release.name,
          force: release.force
        });
        return { updated: false, optionalUpdateAvailable: true, release };
      }
      await clearUpdateIssueNotificationState('permission');
      await setStatus('downloading', {
        localVersion,
        version: release.version,
        name: release.name,
        directoryName: root.name
      });
      const fileCount = await installRelease(root, release);
      const reloadRequired = release.reload;
      const record = {
        ver: release.version,
        name: release.name,
        description: release.description,
        fileCount,
        force: release.force,
        reload: reloadRequired,
        clean: release.clean,
        appliedAt: Date.now(),
        background: true
      };
      if (!reloadRequired) {
        await chrome.storage.local.set({
          [APPLIED_WITHOUT_RELOAD_KEY]: record,
          [PENDING_RELOAD_KEY]: null,
          [INSTALLED_RELEASE_DESCRIPTION_KEY]: {
            version: release.version,
            desc: release.description,
            updatedAt: Date.now()
          },
          [STATUS_KEY]: { status: 'complete', ...record, checkedAt: Date.now(), directoryName: root.name }
        });
        const refreshedAppCount = await globalThis.BjtuForegroundAppPages?.refresh?.().catch(() => 0) || 0;
        await notifyUpdateComplete(
          release,
          refreshedAppCount > 0
            ? `已更新到 ${notificationVersion(release)}，并自动刷新已打开的课程助手页面。`
            : `已更新到 ${notificationVersion(release)}，下次打开课程助手页面时生效。`
        ).catch(() => {});
        return { updated: true, reloaded: false, release, fileCount };
      }
      const appUrl = chrome.runtime.getURL('app/app.html');
      const appWasOpen = (await chrome.tabs.query({})).some((tab) => String(tab?.url || '').startsWith(appUrl));
      const completionNotificationId = await notifyUpdateComplete(
        release,
        `已更新到 ${notificationVersion(release)}，正在自动重新加载扩展。`
      ).catch(() => `${COMPLETE_NOTIFICATION_PREFIX}${normalizeVersion(release.version) || 'unknown'}`);
      await chrome.storage.local.set({
        [PENDING_RELOAD_KEY]: { ...record, autoReloadRequestedAt: Date.now() },
        [INSTALLED_RELEASE_DESCRIPTION_KEY]: {
          version: release.version,
          desc: release.description,
          updatedAt: Date.now()
        },
        [RELOAD_HANDOFF_KEY]: {
          ...record,
          hasName: release.hasName,
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

  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (!notificationId.startsWith(DETECTED_NOTIFICATION_PREFIX)) return;
    const version = notificationId.slice(DETECTED_NOTIFICATION_PREFIX.length);
    void (async () => {
      if (buttonIndex === 1) {
        await chrome.storage.local.set({ ignoredUpdateVersion: version });
      } else if (buttonIndex === 0) {
        await chrome.notifications.clear(notificationId);
        if (runningPromise) await runningPromise;
        await runBackgroundUpdate({ forceCheck: true, installVersion: version });
        return;
      }
      await chrome.notifications.clear(notificationId);
    })().catch((error) => console.warn('[bjtu] update notification action failed:', error));
  });

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
    if (area !== 'local' || (!changes[ENABLED_KEY] && !changes[INSTALL_OPTIONAL_KEY] && !changes[INSTALL_FORCED_KEY] && !changes[INTERVAL_KEY])) return;
    void ensureAlarm();
    if (changes[ENABLED_KEY]?.newValue === true || changes[INSTALL_OPTIONAL_KEY]?.newValue === true || changes[INSTALL_FORCED_KEY]?.newValue === true) {
      runBackgroundUpdate().catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'VERIFY_UPDATER_DIRECTORY_BACKGROUND_ACCESS') {
      verifyBackgroundDirectoryWriteAccess(message?.expectedForegroundProbe)
        .then((probe) => sendResponse({ ok: true, probe }))
        .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
      return true;
    }
    if (message?.type === 'BACKGROUND_UPDATE_MODULE_SELECTION') {
      sendResponse({ ok: resolveManualModuleSelection(message?.payload) });
      return false;
    }
    if (!['BACKGROUND_UPDATE_CHECK_NOW', 'BACKGROUND_UPDATE_INSTALL_CLEAN'].includes(message?.type)) return false;
    const task = message.type === 'BACKGROUND_UPDATE_INSTALL_CLEAN'
      ? runManualCleanInstall(message?.payload, sender)
      : runBackgroundUpdate({ forceCheck: true });
    task
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  });
  void globalThis.BjtuUpdateFileSystem.ensureFileConcurrencyDefaults().then(ensureAlarm)
    .catch((error) => console.warn('[bjtu] updater defaults initialization failed:', error));
})();
