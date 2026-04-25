let db;
let persistTimer;
let persistChain = Promise.resolve();
let persistDirty = false;

function isStorageReady() {
  return !!db;
}

async function initStorage() {
  const SQL = await initSqlJs({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}`,
  });

  const saved = await idbKeyval.get('read.db');
  db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    title TEXT,
    model TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    is_open INTEGER NOT NULL DEFAULT 1
  )`);

  // Add is_open column for databases created before it existed.
  try {
    db.run('ALTER TABLE conversations ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1');
  } catch (e) {
    if (!String(e.message || '').includes('duplicate column')) throw e;
  }

  await migrateFromLocalStorage();
}

async function migrateFromLocalStorage() {
  const legacy = localStorage.getItem('listOfConversations');
  if (!legacy) return;

  const count = db.exec('SELECT COUNT(*) FROM conversations')[0].values[0][0];
  if (count > 0) {
    return;
  }

  try {
    const parsed = JSON.parse(legacy).map((e) =>
      Array.isArray(e) ? { model: 'gpt-4o', messages: e, title: '' } : e
    );
    const stmt = db.prepare('INSERT INTO conversations (title, model, messages_json, is_open) VALUES (?, ?, ?, ?)');
    for (const c of parsed) {
      if (!Array.isArray(c.messages) || c.messages.length === 0) continue;
      stmt.run([c.title?.trim() || null, c.model || 'gpt-4o', JSON.stringify(c.messages), 1]);
    }
    stmt.free();
    await idbKeyval.set('read.db', db.export());
    localStorage.removeItem('listOfConversations');
  } catch (err) {
    console.error('Failed to migrate legacy conversations:', err);
  }
}

// `messages_json` historically held just the messages array. It now holds
// `{ messages, summary, summarizedCount }` so the running summary survives
// reloads. Legacy array-shape rows are detected on load and upgraded on the
// next save.
function decodeMessagesJson(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { messages: parsed, summary: '', summarizedCount: 0 };
  }
  return {
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    summarizedCount:
      typeof parsed.summarizedCount === 'number' ? parsed.summarizedCount : 0,
  };
}

function encodeMessagesJson(c) {
  return JSON.stringify({
    messages: c.messages,
    summary: typeof c.summary === 'string' ? c.summary : '',
    summarizedCount:
      typeof c.summarizedCount === 'number' ? c.summarizedCount : 0,
  });
}

function dbLoadAll() {
  if (!db) return [];
  const result = db.exec('SELECT id, title, model, messages_json, is_open FROM conversations ORDER BY id');
  if (!result.length) return [];
  return result[0].values.map(([_id, title, model, messages_json, is_open]) => {
    const trimmed = (title || '').trim();
    const decoded = decodeMessagesJson(messages_json);
    return {
      title: trimmed,
      titleEdited: trimmed.length > 0,
      model,
      messages: decoded.messages,
      summary: decoded.summary,
      summarizedCount: decoded.summarizedCount,
      isOpen: is_open !== 0,
    };
  });
}

function dbSaveAll(list) {
  if (!db) return;
  db.run('BEGIN');
  try {
    db.run('DELETE FROM conversations');
    const stmt = db.prepare('INSERT INTO conversations (title, model, messages_json, is_open) VALUES (?, ?, ?, ?)');
    for (const c of list) {
      stmt.run([c.title?.trim() || null, c.model, encodeMessagesJson(c), c.isOpen === false ? 0 : 1]);
    }
    stmt.free();
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  schedulePersist();
}

function schedulePersist() {
  persistDirty = true;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(runPersist, 100);
}

function runPersist() {
  if (!persistDirty || !db) return;
  persistDirty = false;
  const bytes = db.export();
  persistChain = persistChain
    .catch(() => {})
    .then(() => idbKeyval.set('read.db', bytes))
    .catch((err) => console.error('Failed to persist db:', err));
  return persistChain;
}

function flushPersist() {
  clearTimeout(persistTimer);
  return runPersist() || persistChain;
}

window.addEventListener('pagehide', flushPersist);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPersist();
});
