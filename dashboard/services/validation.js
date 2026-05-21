/**
 * Validation + normalization for user-submitted words.
 *
 * Goals:
 *   - Cap length (defend against abusive payloads).
 *   - Restrict charset to letters, digits, spaces, hyphens and apostrophes.
 *   - Collapse internal whitespace.
 *   - Reject blocklisted words.
 *   - Return a canonical lowercase form, or `null` if input is invalid.
 */

const MAX_LENGTH = 32;
const ALLOWED_PATTERN = /[^\p{L}\p{N}\s'-]/gu;

// Tiny baseline blocklist; extend via BLOCKED_WORDS env (comma-separated).
const BASE_BLOCKLIST = ['nigger', 'faggot', 'kike', 'chink', 'spic', 'tranny'];

function envBlocklist() {
    return String(process.env.BLOCKED_WORDS || '')
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
}

// Mutable runtime set: baseline + env + admin-added words.
const BLOCKLIST = new Set([...BASE_BLOCKLIST, ...envBlocklist()]);

function isBlocked(word) {
    return BLOCKLIST.has(word);
}

/** Add a word to the runtime blocklist. Returns true if added. */
function addBlocked(raw) {
    const word = normalizeForBlocklist(raw);
    if (!word) return false;
    if (BLOCKLIST.has(word)) return false;
    BLOCKLIST.add(word);
    return true;
}

/** Remove a word from the runtime blocklist. Returns true if removed. */
function removeBlocked(raw) {
    const word = normalizeForBlocklist(raw);
    if (!word) return false;
    return BLOCKLIST.delete(word);
}

/** Return a sorted snapshot of the current blocklist. */
function listBlocked() {
    return Array.from(BLOCKLIST).sort();
}

/** Replace the runtime blocklist with baseline + env + provided extras. */
function setCustomBlocklist(extras = []) {
    BLOCKLIST.clear();
    for (const w of BASE_BLOCKLIST) BLOCKLIST.add(w);
    for (const w of envBlocklist()) BLOCKLIST.add(w);
    for (const w of extras || []) {
        const n = normalizeForBlocklist(w);
        if (n) BLOCKLIST.add(n);
    }
}

/** Return the admin-added portion of the blocklist (excludes baseline + env). */
function getCustomBlocklist() {
    const baseline = new Set([...BASE_BLOCKLIST, ...envBlocklist()]);
    return Array.from(BLOCKLIST).filter((w) => !baseline.has(w)).sort();
}

function normalizeForBlocklist(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw
        .normalize('NFKC')
        .toLowerCase()
        .replace(ALLOWED_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LENGTH);
    return cleaned || null;
}

function normalizeGuess(raw) {
    if (typeof raw !== 'string') return null;

    const cleaned = raw
        .normalize('NFKC')
        .toLowerCase()
        .replace(ALLOWED_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_LENGTH);

    if (cleaned.length < 1) return null;
    if (isBlocked(cleaned)) return null;
    return cleaned;
}

module.exports = {
    MAX_LENGTH,
    normalizeGuess,
    isBlocked,
    addBlocked,
    removeBlocked,
    listBlocked,
    setCustomBlocklist,
    getCustomBlocklist
};
