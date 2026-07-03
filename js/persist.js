// Persistence: IndexedDB autosave + File System Access directory handle storage.

const DB_NAME = 'clearcoat';
const DB_VERSION = 1;
const STORE = 'kv';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function kvDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ---------- autosave ----------

export const saveAutosave = (data) => kvSet('autosave', data);
export const loadAutosave = () => kvGet('autosave');
export const clearAutosave = () => kvDelete('autosave');

export const saveSetting = (key, value) => kvSet('setting:' + key, value);
export const loadSetting = (key) => kvGet('setting:' + key);

// ---------- projects ----------
// Index entries are {id, name, updatedAt, thumb} — thumb is a small dataURL
// kept in the index so the project browser lists without loading full docs.

const PROJECTS_INDEX = 'projects:index';

export const listProjects = async () => (await kvGet(PROJECTS_INDEX)) || [];

export async function saveProject(id, meta, data) {
  await kvSet('project:' + id, data);
  const index = await listProjects();
  const i = index.findIndex(p => p.id === id);
  const entry = { ...(i === -1 ? {} : index[i]), id, ...meta, updatedAt: Date.now() };
  if (i === -1) index.push(entry); else index[i] = entry;
  await kvSet(PROJECTS_INDEX, index);
}

export const loadProject = (id) => kvGet('project:' + id);

export async function deleteProject(id) {
  await kvDelete('project:' + id);
  await kvSet(PROJECTS_INDEX, (await listProjects()).filter(p => p.id !== id));
}

export async function renameProject(id, name) {
  const index = await listProjects();
  const entry = index.find(p => p.id === id);
  if (!entry) return;
  entry.name = name;
  await kvSet(PROJECTS_INDEX, index);
  const data = await kvGet('project:' + id); // stored doc name stays in agreement
  if (data) { data.name = name; await kvSet('project:' + id, data); }
}

// ---------- File System Access ----------

export const fsSupported = () => 'showDirectoryPicker' in window;

export async function pickPaintsFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await kvSet('paintsDir', handle);
  return handle;
}

// Returns a usable handle or null. Re-requests permission if needed
// (must be called from a user gesture for the permission prompt to show).
export async function getPaintsFolder({ requestIfNeeded = false } = {}) {
  const handle = await kvGet('paintsDir');
  if (!handle) return null;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'prompt' && requestIfNeeded) {
    perm = await handle.requestPermission({ mode: 'readwrite' });
  }
  return perm === 'granted' ? handle : (requestIfNeeded ? null : handle);
}

export async function writeFileToFolder(dirHandle, filename, blob) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// Returns the File or null if it doesn't exist.
export async function readFileFromFolder(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    return await fh.getFile();
  } catch {
    return null;
  }
}

export async function getBackupDir(dirHandle, create = false) {
  try {
    return await dirHandle.getDirectoryHandle('clearcoat-backup', { create });
  } catch {
    return null;
  }
}

export async function deleteFromFolder(dirHandle, filename) {
  try { await dirHandle.removeEntry(filename); } catch { /* already gone */ }
}

// All file names in the folder (non-recursive).
export async function listFolder(dirHandle) {
  const names = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') names.push(entry.name);
    }
  } catch { /* permission revoked mid-iteration */ }
  return names;
}
