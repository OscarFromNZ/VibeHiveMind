/**
 * Public read-only JSON API.
 *
 * - GET /api/today       — current day snapshot
 * - GET /api/leaderboard — full ranked leaderboard (capped)
 * - GET /api/archive     — past day summaries
 */

const express = require('express');
const router = express.Router();

const LEADERBOARD_CAP = 50;

function buildLeaderboard(guessCounts, cap = LEADERBOARD_CAP) {
    return Object.entries(guessCounts || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, cap)
        .map(([word, count], i) => ({ rank: i + 1, word, count }));
}

router.get('/api/today', (req, res) => {
    const locals = req.app.locals;
    const guessCounts = locals.guessCounts || {};
    res.json({
        day: locals.currentDay,
        word: locals.word,
        totalGuesses: locals.totalGuesses || 0,
        uniqueWords: Object.keys(guessCounts).length,
        topGuesses: buildLeaderboard(guessCounts, 10)
    });
});

router.get('/api/leaderboard', (req, res) => {
    const cap = Math.max(1, Math.min(parseInt(req.query.limit, 10) || LEADERBOARD_CAP, LEADERBOARD_CAP));
    res.json({
        day: req.app.locals.currentDay,
        word: req.app.locals.word,
        leaderboard: buildLeaderboard(req.app.locals.guessCounts, cap)
    });
});

router.get('/api/archive', (req, res) => {
    const history = req.app.locals.history || [];
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 30, 365));
    res.json({
        count: history.length,
        entries: history.slice(0, limit)
    });
});

module.exports = router;
