const express = require('express');
const verifyRecaptcha = require('../middleware/verifyRecaptcha');
const { normalizeGuess } = require('../services/validation');
const { currentUtcDay } = require('../services/dailyReset');

const router = express.Router();

/* ---------- Rate-limit (in-memory, per-IP) ---------- */

const SUBMIT_COOLDOWN_MS = 3_000;
const VOTE_COOLDOWN_MS = 30_000;
const submitRateLimit = new Map();
const voteRateLimit = new Map();

function clientIp(req) {
    return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

function checkRateLimit(map, key, cooldownMs) {
    const now = Date.now();
    const last = map.get(key) || 0;
    if (now - last < cooldownMs) return false;
    map.set(key, now);
    return true;
}

// Periodically prune stale rate-limit entries so the maps don't grow unbounded.
setInterval(() => {
    const now = Date.now();
    const horizon = now - Math.max(SUBMIT_COOLDOWN_MS, VOTE_COOLDOWN_MS) * 10;
    for (const [k, v] of submitRateLimit) if (v < horizon) submitRateLimit.delete(k);
    for (const [k, v] of voteRateLimit) if (v < horizon) voteRateLimit.delete(k);
}, 60_000).unref();

/* ---------- Helpers ---------- */

function getOrdinalSuffix(rank) {
    if (rank % 100 >= 11 && rank % 100 <= 13) {
        return `${rank}th`;
    }
    switch (rank % 10) {
        case 1: return `${rank}st`;
        case 2: return `${rank}nd`;
        case 3: return `${rank}rd`;
        default: return `${rank}th`;
    }
}

/**
 * Compute the player's score from the in-memory guess counts stored on
 * app.locals. Pure read; doesn't mutate counters.
 */
function getScore(guess, locals) {
    const totalGuesses = Object.values(locals.guessCounts)
        .reduce((sum, count) => sum + count, 0);
    locals.totalGuesses = totalGuesses;

    const sortedGuesses = Object.entries(locals.guessCounts)
        .sort((a, b) => b[1] - a[1]);

    const mostCommonWord = sortedGuesses[0]?.[0] || '';
    const playerRankIndex = sortedGuesses.findIndex(([word]) => word === guess);
    const playerRank = getOrdinalSuffix(playerRankIndex + 1);
    const playerGuessCount = locals.guessCounts[guess] || 0;
    const guessPercentage = totalGuesses > 0
        ? ((playerGuessCount / totalGuesses) * 100).toFixed(2)
        : '0.00';

    const leaderboard = sortedGuesses.slice(0, 10).map(([word, count], index) => ({
        rank: getOrdinalSuffix(index + 1),
        word,
        count
    }));

    const scoreMessage =
        `🧠 Hivemind Score 🏆\n` +
        `Today's word: "${locals.word}"\n` +
        `I ranked: ${playerRank} / ${totalGuesses} guesses with my guess\n` +
        `🔥 ${guessPercentage}% of players guessed the same as me.\n` +
        `https://hivemindgame.space/`;

    return {
        scoreMessage,
        guess,
        rank: playerRank,
        percentage: guessPercentage,
        totalGuesses,
        mostCommon: mostCommonWord,
        leaderboard
    };
}

function renderResults(req, res, guess) {
    const score = getScore(guess, req.app.locals);

    return res.render('result', {
        score,
        guess,
        word: req.app.locals.word,
        hasVoted: Boolean(req.session.hasVoted),
        votedWords: req.app.locals.votedWords || {},
        streak: req.session.streak || 0,
        nextResetMs: msUntilNextUtcMidnight()
    });
}

/** Milliseconds until the next UTC midnight (when the day rolls over). */
function msUntilNextUtcMidnight(now = new Date()) {
    const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0, 0, 0, 0
    );
    return next - now.getTime();
}

/**
 * Rolls submission state forward when the UTC day changes so a yesterday's
 * submitter can play again today.
 */
function rollSessionDay(req) {
    const today = currentUtcDay();
    if (req.session.submittedOnDay !== today) {
        req.session.hasSubmitted = false;
        req.session.hasVoted = false;
        req.session.guess = null;
        req.session.submittedOnDay = null;
    }
}

/* ---------- Routes ---------- */

router.get('/', (req, res) => {
    rollSessionDay(req);

    if (req.session.hasSubmitted && req.session.guess) {
        return renderResults(req, res, req.session.guess);
    }

    return res.render('game', {
        word: req.app.locals.word,
        totalGuesses: req.app.locals.totalGuesses
    });
});

router.post('/', async (req, res) => {
    rollSessionDay(req);

    if (req.session.hasSubmitted) {
        return res.status(403).send('You have already submitted!');
    }

    if (!checkRateLimit(submitRateLimit, clientIp(req), SUBMIT_COOLDOWN_MS)) {
        return res.status(429).send('Slow down — try again in a moment.');
    }

    const { guess, 'g-recaptcha-response': recaptchaResponse } = req.body;
    const normalizedGuess = normalizeGuess(guess);
    if (!normalizedGuess) {
        return res.redirect('/');
    }

    // Verify reCAPTCHA BEFORE incrementing counts — otherwise a bot can poison
    // the leaderboard without ever passing the challenge.
    if (!await verifyRecaptcha(recaptchaResponse)) {
        console.warn('reCAPTCHA validation failed for submission:', normalizedGuess);
        return res.redirect('/');
    }

    req.app.locals.guessCounts[normalizedGuess] =
        (req.app.locals.guessCounts[normalizedGuess] || 0) + 1;
    req.app.locals.totalGuesses++;
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();

    req.session.hasSubmitted = true;
    req.session.guess = normalizedGuess;
    req.session.submittedOnDay = currentUtcDay();

    // Streak tracking — consecutive UTC days played.
    const today = currentUtcDay();
    const last = req.session.lastPlayedDay;
    if (last === today - 1) {
        req.session.streak = (req.session.streak || 0) + 1;
    } else if (last !== today) {
        req.session.streak = 1;
    }
    req.session.lastPlayedDay = today;

    return renderResults(req, res, normalizedGuess);
});

router.post('/vote', (req, res) => {
    rollSessionDay(req);

    if (!req.session.hasSubmitted) return res.redirect('/');
    if (req.session.hasVoted) return res.redirect('/');

    const normalizedWord = normalizeGuess(req.body && req.body.word);
    if (!normalizedWord) {
        return res.status(400).json({ message: 'Invalid word!' });
    }

    if (!checkRateLimit(voteRateLimit, clientIp(req), VOTE_COOLDOWN_MS)) {
        return res.status(429).json({ message: "You're voting too fast! Try again later." });
    }

    req.app.locals.votedWords[normalizedWord] =
        (req.app.locals.votedWords[normalizedWord] || 0) + 1;
    req.session.hasVoted = true;
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();

    return res.redirect('/');
});

module.exports = router;
