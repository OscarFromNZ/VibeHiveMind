/**
 * UTC day-of-year helper + daily counter reset.
 *
 * "Day" is defined as integer day-of-year in UTC. Matches the client-side
 * issue-number math in /js/game.js and /js/result.js.
 */

function currentUtcDay(now = new Date()) {
    const start = Date.UTC(now.getUTCFullYear(), 0, 0);
    return Math.floor((now.getTime() - start) / 86_400_000);
}

/**
 * Reset the per-day counters on `app.locals`. The word and word schedule are
 * preserved — only guess/vote tallies are zeroed.
 */
function resetDailyCounters(locals) {
    locals.guessCounts = {};
    locals.totalGuesses = 0;
    locals.votedWords = {};
    locals.currentDay = currentUtcDay();
}

module.exports = {
    currentUtcDay,
    resetDailyCounters
};
