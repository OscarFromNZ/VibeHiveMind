/**
 * Daily history archive.
 *
 * Each entry captures the state of a finished day:
 *   { day, date, word, totalGuesses, uniqueWords, topGuesses, topVoted }
 *
 * Archive lives on `locals.history` (capped) and is persisted with the rest
 * of the state snapshot.
 */

const MAX_ENTRIES = 365;

function topN(map, n) {
    return Object.entries(map || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([word, count]) => ({ word, count }));
}

function utcDateString(now = new Date()) {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Snapshot the day that's about to end. Only archives if there's meaningful
 * activity (>0 guesses) so empty boots don't pollute history.
 */
function archiveCurrentDay(locals, { now = new Date() } = {}) {
    if (!locals.history) locals.history = [];

    const totalGuesses = locals.totalGuesses || 0;
    if (totalGuesses <= 0) return null;

    const guessCounts = locals.guessCounts || {};
    const entry = {
        day: locals.currentDay,
        date: utcDateString(now),
        word: locals.word,
        totalGuesses,
        uniqueWords: Object.keys(guessCounts).length,
        topGuesses: topN(guessCounts, 5),
        topVoted: topN(locals.votedWords, 3)
    };

    // Replace if we already archived this same day (idempotent).
    const existingIdx = locals.history.findIndex((h) => h.day === entry.day);
    if (existingIdx !== -1) {
        locals.history[existingIdx] = entry;
    } else {
        locals.history.unshift(entry); // newest first
    }

    if (locals.history.length > MAX_ENTRIES) {
        locals.history.length = MAX_ENTRIES;
    }

    return entry;
}

module.exports = {
    archiveCurrentDay,
    MAX_ENTRIES
};
