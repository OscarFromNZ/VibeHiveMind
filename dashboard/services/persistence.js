/**
 * Disk-backed persistence for the in-memory game state.
 *
 * - State lives in `app.locals` while the server runs.
 * - A JSON snapshot is written to `data/state.json` on a debounce timer
 *   whenever `markDirty()` is called.
 * - On boot, `loadInto(locals)` restores prior state.
 * - On shutdown, `flush()` writes a final snapshot synchronously.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'data', 'state.json');
const DEBOUNCE_MS = 1500;

function defaultState() {
    return {
        savedAt: null,
        currentDay: null,
        word: 'Spring',
        guessCounts: {},
        totalGuesses: 0,
        votedWords: {},
        wordSchedules: [],
        history: [],
        customBlocklist: []
    };
}

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readSnapshot(filePath) {
    try {
        if (!fs.existsSync(filePath)) return defaultState();
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...defaultState(), ...parsed };
    } catch (err) {
        console.warn('[persistence] failed to read snapshot:', err.message);
        return defaultState();
    }
}

function snapshotFromLocals(locals) {
    return {
        savedAt: new Date().toISOString(),
        currentDay: locals.currentDay ?? null,
        word: locals.word,
        guessCounts: locals.guessCounts || {},
        totalGuesses: locals.totalGuesses || 0,
        votedWords: locals.votedWords || {},
        wordSchedules: (locals.wordSchedules || []).map((entry) => ({
            id: entry.id,
            word: entry.word,
            time: entry.time,
            cron: entry.cron
        })),
        history: locals.history || [],
        customBlocklist: locals.customBlocklist || []
    };
}

function writeAtomic(filePath, payload) {
    ensureDir(filePath);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, filePath);
}

function createPersistence({ filePath = DEFAULT_PATH, debounceMs = DEBOUNCE_MS } = {}) {
    let timer = null;
    let pendingLocals = null;

    function writeNow(locals) {
        try {
            writeAtomic(filePath, JSON.stringify(snapshotFromLocals(locals), null, 2));
        } catch (err) {
            console.error('[persistence] failed to write snapshot:', err.message);
        }
    }

    function markDirty(locals) {
        pendingLocals = locals;
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            if (pendingLocals) {
                writeNow(pendingLocals);
                pendingLocals = null;
            }
        }, debounceMs);
    }

    function flush(locals) {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pendingLocals = null;
        if (locals) writeNow(locals);
    }

    function load() {
        return readSnapshot(filePath);
    }

    function loadInto(locals) {
        const snapshot = readSnapshot(filePath);
        locals.word = snapshot.word || 'Spring';
        locals.guessCounts = snapshot.guessCounts || {};
        locals.totalGuesses = Number(snapshot.totalGuesses) || 0;
        locals.votedWords = snapshot.votedWords || {};
        locals.currentDay = snapshot.currentDay ?? null;
        locals.history = Array.isArray(snapshot.history) ? snapshot.history : [];
        locals.customBlocklist = Array.isArray(snapshot.customBlocklist) ? snapshot.customBlocklist : [];
        return snapshot;
    }

    return { load, loadInto, markDirty, flush, filePath };
}

module.exports = { createPersistence };
