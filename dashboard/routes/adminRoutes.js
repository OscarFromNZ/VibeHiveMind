const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const {
    addBlocked,
    removeBlocked,
    getCustomBlocklist,
    listBlocked
} = require('../services/validation');
const { archiveCurrentDay } = require('../services/history');
const { resetDailyCounters } = require('../services/dailyReset');
const router = express.Router();

// Admin password (use environment variable in production)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function timingSafeEqualStr(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// Middleware to check if user is authenticated
const requireAdminAuth = (req, res, next) => {
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }
    res.redirect('/admin/login');
};

function buildLeaderboard(guessCounts) {
    return Object.entries(guessCounts || {})
        .sort((a, b) => b[1] - a[1])
        .map(([word, count], index) => ({ rank: index + 1, word, count }));
}

function normalizeWord(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 32);
}

function weightedPick(pool) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let pick = Math.random() * totalWeight;

    for (const item of pool) {
        pick -= item.weight;
        if (pick <= 0) {
            return item.word;
        }
    }

    return pool[pool.length - 1].word;
}

function buildAiGuessPool(currentWord) {
    const normalizedCurrentWord = normalizeWord(currentWord) || 'spring';
    const firstToken = normalizedCurrentWord.split(' ')[0];

    return [
        { word: normalizedCurrentWord, weight: 26 },
        { word: firstToken, weight: 10 },
        { word: 'love', weight: 8 },
        { word: 'life', weight: 8 },
        { word: 'happy', weight: 7 },
        { word: 'sad', weight: 6 },
        { word: 'home', weight: 6 },
        { word: 'family', weight: 6 },
        { word: 'friend', weight: 5 },
        { word: 'time', weight: 5 },
        { word: 'work', weight: 5 },
        { word: 'school', weight: 4 },
        { word: 'money', weight: 4 },
        { word: 'food', weight: 4 },
        { word: 'sleep', weight: 3 },
        { word: 'music', weight: 3 },
        { word: 'day', weight: 3 },
        { word: 'night', weight: 3 },
        { word: 'game', weight: 3 },
        { word: 'phone', weight: 2 },
        { word: 'internet', weight: 2 },
        { word: 'coffee', weight: 2 },
        { word: 'weather', weight: 2 }
    ];
}

function coerceWeightedPool(items, fallbackWord) {
    const normalizedFallback = normalizeWord(fallbackWord) || 'word';
    const pool = [];

    for (const item of items || []) {
        const word = normalizeWord(item && item.word);
        const rawWeight = Number(item && item.weight);
        const weight = Number.isFinite(rawWeight) ? Math.max(1, Math.min(rawWeight, 100)) : 1;

        if (!word || word.length < 2) {
            continue;
        }

        pool.push({ word, weight });
    }

    if (pool.length === 0) {
        pool.push({ word: normalizedFallback, weight: 10 });
    }

    return pool;
}

function parseJsonObjectFromText(raw) {
    if (!raw) {
        throw new Error('No model response content');
    }

    try {
        return JSON.parse(raw);
    } catch (err) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            throw new Error('Invalid JSON from model');
        }
        return JSON.parse(raw.slice(start, end + 1));
    }
}

async function fetchCopilotGuessPool(currentWord) {
    const apiKey = process.env.COPILOT_API_KEY || process.env.GITHUB_TOKEN;
    if (!apiKey) {
        throw new Error('COPILOT_API_KEY or GITHUB_TOKEN missing');
    }

    const model = process.env.COPILOT_MODEL || 'gpt-4o-mini';
    const endpoint = process.env.COPILOT_API_URL || 'https://models.inference.ai.azure.com/chat/completions';
    const promptWord = normalizeWord(currentWord) || 'spring';

    const response = await axios.post(
        endpoint,
        {
            model,
            temperature: 0.8,
            max_tokens: 500,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'You generate realistic one or two word human guesses for a word association game. Return JSON only.'
                },
                {
                    role: 'user',
                    content:
                        'Main word: "' + promptWord + '". ' +
                        'Generate 25 realistic guesses people would make for this word. ' +
                        'Return JSON in this exact shape: {"guesses":[{"word":"...","weight":number}]}. ' +
                        'Weights should be 1-100 and represent relative frequency.'
                }
            ]
        },
        {
            headers: {
                Authorization: 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 12000
        }
    );

    const raw = response.data
        && response.data.choices
        && response.data.choices[0]
        && response.data.choices[0].message
        && response.data.choices[0].message.content;

    const parsed = parseJsonObjectFromText(raw);
    return coerceWeightedPool(parsed.guesses, promptWord);
}

async function fetchGeminiGuessPool(currentWord) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY missing');
    }

    const apiHost = process.env.GEMINI_API_HOST || 'https://generativelanguage.googleapis.com';
    const apiVersion = process.env.GEMINI_API_VERSION || 'v1';
    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const promptWord = normalizeWord(currentWord) || 'spring';

    const listModelsEndpoint = `${apiHost}/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`;
    const listModelsResponse = await axios.get(listModelsEndpoint, { timeout: 12000 });
    const models = listModelsResponse.data && listModelsResponse.data.models ? listModelsResponse.data.models : [];

    const supportedModels = models
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => m.name)
        .filter(Boolean);

    if (supportedModels.length === 0) {
        throw new Error('No Gemini models support generateContent for this API version');
    }

    const preferredModelName = preferredModel.startsWith('models/') ? preferredModel : `models/${preferredModel}`;
    const fallbackCandidates = [
        preferredModelName,
        'models/gemini-2.5-flash',
        'models/gemini-2.0-flash',
        'models/gemini-2.0-flash-lite',
        'models/gemini-2.0-flash-001',
        'models/gemini-2.0-flash-lite-001'
    ];

    let resolvedModel = fallbackCandidates.find((candidate) => supportedModels.includes(candidate));
    if (!resolvedModel) {
        resolvedModel = supportedModels[0];
    }

    const endpoint = process.env.GEMINI_API_URL
        || `${apiHost}/${apiVersion}/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await axios.post(
        endpoint,
        {
            generationConfig: {
                temperature: 0.8
            },
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text:
                                'You are generating realistic guesses in a word association game. ' +
                                'Main word: "' + promptWord + '". ' +
                                'Generate 25 realistic guesses people would make for this word. ' +
                                'Return JSON in this exact shape: {"guesses":[{"word":"...","weight":number}]}. ' +
                                'Weights should be 1-100 and represent relative frequency.'
                        }
                    ]
                }
            ]
        },
        {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 12000
        }
    );

    const raw = response.data
        && response.data.candidates
        && response.data.candidates[0]
        && response.data.candidates[0].content
        && response.data.candidates[0].content.parts
        && response.data.candidates[0].content.parts[0]
        && response.data.candidates[0].content.parts[0].text;

    const parsed = parseJsonObjectFromText(raw);
    return coerceWeightedPool(parsed.guesses, promptWord);
}

function getProviderErrorMessage(error) {
    const status = error && error.response && error.response.status;
    const apiError = error && error.response && error.response.data && error.response.data.error;
    const geminiError = error && error.response && error.response.data && error.response.data.error;
    const code = apiError && apiError.code ? apiError.code : 'unknown_error';
    const message = (apiError && apiError.message)
        || (geminiError && geminiError.message)
        || (error && error.message)
        || 'Unknown failure';

    return {
        status,
        code,
        message
    };
}

// Admin login page
router.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: req.query.error || null });
});

// Admin login handler with reCAPTCHA verification
router.post('/admin/login', async (req, res) => {
    const { password, 'g-recaptcha-response': captchaToken } = req.body;

    if (!password || !timingSafeEqualStr(password, ADMIN_PASSWORD)) {
        return res.redirect('/admin/login?error=Invalid+password');
    }

    if (!captchaToken) {
        return res.redirect('/admin/login?error=Please+complete+the+reCAPTCHA');
    }

    try {
        const recaptchaSecret = process.env.RECAPTCHA_SECRET || '6Lfwn9sqAAAAALK-vlh1gzL4x4e6Lt25rDYGqF1k';
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';

        const response = await axios.post(verificationUrl, null, {
            params: {
                secret: recaptchaSecret,
                response: captchaToken
            },
            timeout: 5000
        });

        if (response.data.success) {
            req.session.adminAuthenticated = true;
            res.redirect('/admin');
        } else {
            res.redirect('/admin/login?error=reCAPTCHA+verification+failed');
        }
    } catch (error) {
        res.redirect('/admin/login?error=Verification+error');
    }
});

// Admin logout
router.get('/admin/logout', (req, res) => {
    req.session.adminAuthenticated = false;
    res.redirect('/');
});

router.get('/admin', requireAdminAuth, (req, res) => {
    const currentWord = req.app.locals.word;
    const totalGuesses = req.app.locals.totalGuesses;
    const leaderboard = buildLeaderboard(req.app.locals.guessCounts);
    const scheduledWords = req.app.locals.wordSchedules || [];
    const message = req.query.message || null;

    // Calculate stats
    const guessCounts = req.app.locals.guessCounts || {};
    const totalUniqueWords = Object.keys(guessCounts).length;

    // Top voted words (from /vote endpoint)
    const votedWords = Object.entries(req.app.locals.votedWords || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count], i) => ({ rank: i + 1, word, count }));

    // Archive (newest first, capped for display)
    const history = (req.app.locals.history || []).slice(0, 30);

    // Runtime blocklist split into baseline+env vs admin-added
    const customBlocklist = getCustomBlocklist();
    const allBlocked = listBlocked();

    const startedAt = req.app.locals.startedAt || new Date();
    const uptimeSec = Math.round((Date.now() - startedAt.getTime()) / 1000);

    res.render('admin', {
        currentWord,
        totalGuesses,
        totalUniqueWords,
        leaderboard,
        scheduledWords,
        votedWords,
        history,
        customBlocklist,
        allBlocked,
        currentDay: req.app.locals.currentDay,
        uptimeSec,
        archivedCount: (req.app.locals.history || []).length,
        message
    });
});

router.post('/admin/change-word', requireAdminAuth, (req, res) => {
    const { word } = req.body;
    if (!word || !word.trim()) {
        return res.redirect('/admin?message=Invalid+word');
    }

    req.app.locals.word = word.trim();
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    res.redirect('/admin?message=Word+changed+to+%22' + encodeURIComponent(req.app.locals.word) + '%22');
});

router.post('/admin/schedule-word', requireAdminAuth, (req, res) => {
    const { word, time } = req.body;
    if (!word || !word.trim() || !time || !/^\d{1,2}:\d{2}$/.test(time.trim())) {
        return res.redirect('/admin?message=Invalid+word+or+time+format');
    }

    if (typeof req.app.locals.addWordSchedule !== 'function') {
        return res.redirect('/admin?message=Scheduling+is+not+available');
    }

    const entry = req.app.locals.addWordSchedule(word.trim(), time.trim());
    if (!entry) {
        return res.redirect('/admin?message=Invalid+schedule+time');
    }

    res.redirect('/admin?message=Scheduled+word+%22' + encodeURIComponent(entry.word) + '%22+at+' + encodeURIComponent(entry.time));
});

router.post('/admin/remove-leaderboard', requireAdminAuth, (req, res) => {
    const { word } = req.body;
    if (!word || !word.trim()) {
        return res.redirect('/admin?message=Invalid+leaderboard+entry');
    }

    const normalizedWord = word.trim().toLowerCase();
    const counts = req.app.locals.guessCounts || {};
    const removedCount = counts[normalizedWord] || 0;

    if (removedCount > 0) {
        delete counts[normalizedWord];
        req.app.locals.totalGuesses = Math.max(0, req.app.locals.totalGuesses - removedCount);
        if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    }

    res.redirect('/admin?message=Removed+%22' + encodeURIComponent(normalizedWord) + '%22+from+leaderboard');
});

router.post('/admin/remove-schedule', requireAdminAuth, (req, res) => {
    const { scheduleId } = req.body;
    if (!scheduleId || !req.app.locals.removeWordSchedule) {
        return res.redirect('/admin?message=Invalid+schedule+entry');
    }

    req.app.locals.removeWordSchedule(scheduleId);
    res.redirect('/admin?message=Schedule+removed');
});

// Clear all leaderboard data
router.post('/admin/clear-leaderboard', requireAdminAuth, (req, res) => {
    req.app.locals.guessCounts = {};
    req.app.locals.totalGuesses = 0;
    req.app.locals.votedWords = {};
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    res.redirect('/admin?message=Leaderboard+cleared');
});

// Generate fake AI guess data
router.post('/admin/generate-fake-data', requireAdminAuth, async (req, res) => {
    const parsedCount = Number.parseInt(req.body.count, 10);
    const fakeCount = Number.isFinite(parsedCount) ? Math.max(1, Math.min(parsedCount, 5000)) : 100;
    const mode = (req.body.mode || 'ai').toLowerCase();

    const uniformWords = [
        'apple', 'banana', 'cat', 'dog', 'tree', 'house', 'car', 'book', 'phone', 'computer',
        'water', 'fire', 'earth', 'sky', 'sun', 'moon', 'star', 'cloud', 'rain', 'snow',
        'table', 'chair', 'lamp', 'door', 'window', 'wall', 'floor', 'roof', 'bed', 'sofa',
        'happy', 'sad', 'angry', 'calm', 'excited', 'tired', 'hungry', 'thirsty', 'cold', 'warm',
        'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown', 'black', 'white',
        'fast', 'slow', 'big', 'small', 'tall', 'short', 'loud', 'quiet', 'bright', 'dark',
        'food', 'drink', 'sleep', 'play', 'work', 'run', 'walk', 'jump', 'sing', 'dance',
        'friend', 'family', 'school', 'teacher', 'student', 'office', 'money', 'time', 'love', 'peace'
    ];

    const guessCounts = req.app.locals.guessCounts || {};
    let addedCount = 0;
    let source = mode;
    let aiPool = mode === 'ai' ? buildAiGuessPool(req.app.locals.word) : [];

    if (mode === 'copilot' || mode === 'gemini') {
        try {
            aiPool = mode === 'copilot'
                ? await fetchCopilotGuessPool(req.app.locals.word)
                : await fetchGeminiGuessPool(req.app.locals.word);
            source = mode;
        } catch (error) {
            const details = getProviderErrorMessage(error);
            const providerName = mode === 'copilot' ? 'Copilot' : 'Gemini';
            let summary = details.code + ': ' + details.message;
            if (details.status === 429) {
                summary = 'API quota exhausted. Use Local AI mode instead, or top up your ' + providerName + ' billing.';
            } else if (details.status === 401 || details.status === 403) {
                summary = 'Invalid or missing API key for ' + providerName + '.';
            }
            const detailsText = [
                encodeURIComponent(providerName + ' generation failed'),
                details.status ? encodeURIComponent(' (HTTP ' + details.status + ')') : '',
                encodeURIComponent(': '),
                encodeURIComponent(summary)
            ].join('');
            return res.redirect('/admin?message=' + detailsText);
        }
    } else if (mode !== 'uniform' && mode !== 'ai') {
        return res.redirect('/admin?message=Invalid+generation+mode');
    }

    for (let i = 0; i < fakeCount; i++) {
        const randomWord = mode === 'uniform'
            ? uniformWords[Math.floor(Math.random() * uniformWords.length)]
            : weightedPick(aiPool);
        const key = normalizeWord(randomWord);
        if (!key) {
            continue;
        }
        guessCounts[key] = (guessCounts[key] || 0) + 1;
        addedCount++;
    }

    req.app.locals.guessCounts = guessCounts;
    req.app.locals.totalGuesses = Object.values(guessCounts).reduce((a, b) => a + b, 0);
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();

    res.redirect('/admin?message=Generated+' + addedCount + '+fake+guesses+(' + encodeURIComponent(source) + '+mode)');
});

/* ---------- Manual rollover (archive today + reset counters) ---------- */
router.post('/admin/rollover', requireAdminAuth, (req, res) => {
    const archived = archiveCurrentDay(req.app.locals);
    resetDailyCounters(req.app.locals);
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    const msg = archived
        ? `Archived+%22${encodeURIComponent(archived.word)}%22+and+reset+counters`
        : 'Counters+reset+(nothing+to+archive)';
    res.redirect('/admin?message=' + msg);
});

/* ---------- Cleanup: remove leaderboard entries below a minimum count ---------- */
router.post('/admin/cleanup-leaderboard', requireAdminAuth, (req, res) => {
    const min = Math.max(1, Math.min(parseInt(req.body.minCount, 10) || 2, 1000));
    const counts = req.app.locals.guessCounts || {};
    let removedWords = 0;
    let removedGuesses = 0;
    for (const [word, count] of Object.entries(counts)) {
        if (count < min) {
            removedGuesses += count;
            delete counts[word];
            removedWords++;
        }
    }
    req.app.locals.totalGuesses = Math.max(0, (req.app.locals.totalGuesses || 0) - removedGuesses);
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    res.redirect(`/admin?message=Removed+${removedWords}+entries+(${removedGuesses}+guesses)+below+${min}`);
});

/* ---------- Blocklist management ---------- */
router.post('/admin/blocklist/add', requireAdminAuth, (req, res) => {
    const word = req.body.word;
    if (!addBlocked(word)) {
        return res.redirect('/admin?message=Could+not+add+to+blocklist');
    }
    req.app.locals.customBlocklist = getCustomBlocklist();
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    res.redirect('/admin?message=Blocked+%22' + encodeURIComponent(String(word).trim().toLowerCase()) + '%22');
});

router.post('/admin/blocklist/remove', requireAdminAuth, (req, res) => {
    const word = req.body.word;
    if (!removeBlocked(word)) {
        return res.redirect('/admin?message=Could+not+remove+from+blocklist');
    }
    req.app.locals.customBlocklist = getCustomBlocklist();
    if (typeof req.app.locals.markDirty === 'function') req.app.locals.markDirty();
    res.redirect('/admin?message=Unblocked+%22' + encodeURIComponent(String(word).trim().toLowerCase()) + '%22');
});

/* ---------- Exports ---------- */
router.get('/admin/export.json', requireAdminAuth, (req, res) => {
    const locals = req.app.locals;
    const payload = {
        savedAt: new Date().toISOString(),
        currentDay: locals.currentDay,
        word: locals.word,
        totalGuesses: locals.totalGuesses,
        guessCounts: locals.guessCounts,
        votedWords: locals.votedWords,
        wordSchedules: locals.wordSchedules,
        history: locals.history,
        customBlocklist: locals.customBlocklist
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hivemind-state-day${locals.currentDay}.json"`);
    res.send(JSON.stringify(payload, null, 2));
});

router.get('/admin/export.csv', requireAdminAuth, (req, res) => {
    const counts = req.app.locals.guessCounts || {};
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const lines = ['rank,word,count'];
    rows.forEach(([word, count], i) => {
        const safeWord = `"${String(word).replace(/"/g, '""')}"`;
        lines.push(`${i + 1},${safeWord},${count}`);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leaderboard-day${req.app.locals.currentDay}.csv"`);
    res.send(lines.join('\n'));
});

module.exports = router;
