const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

const gameRoutes = require('./routes/gameRoutes');
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const { createPersistence } = require('./services/persistence');
const { createWordScheduleService } = require('./services/wordSchedule');
const { currentUtcDay, resetDailyCounters } = require('./services/dailyReset');
const { archiveCurrentDay } = require('./services/history');
const { setCustomBlocklist } = require('./services/validation');

function dashboardInit() {
    const app = express();

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.set('trust proxy', 1); // honor X-Forwarded-* when behind a reverse proxy

    /* ---------- State ---------- */

    app.locals.word = 'Spring';
    app.locals.guessCounts = {};
    app.locals.totalGuesses = 0;
    app.locals.guessCache = new Map();
    app.locals.votedWords = {};
    app.locals.wordSchedules = [];
    app.locals.history = [];
    app.locals.currentDay = currentUtcDay();
    app.locals.startedAt = new Date();

    /* ---------- Persistence ---------- */

    const persistence = createPersistence();
    const snapshot = persistence.loadInto(app.locals);
    app.locals.markDirty = () => persistence.markDirty(app.locals);

    // Seed the in-memory blocklist from persisted custom additions.
    setCustomBlocklist(app.locals.customBlocklist);

    // If the persisted day is stale, roll counters over before going live.
    const today = currentUtcDay();
    if (app.locals.currentDay !== today) {
        console.log(`[boot] rolling daily counters (was day ${app.locals.currentDay}, now ${today})`);
        archiveCurrentDay(app.locals);
        resetDailyCounters(app.locals);
        app.locals.markDirty();
    }

    /* ---------- Word schedule ---------- */

    const wordSchedule = createWordScheduleService(app, {
        onChange: () => app.locals.markDirty()
    });
    wordSchedule.restoreAll(snapshot.wordSchedules);
    app.locals.addWordSchedule = wordSchedule.add;
    app.locals.removeWordSchedule = wordSchedule.remove;

    /* ---------- Middleware ---------- */

    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.urlencoded({ extended: false, limit: '16kb' }));
    app.use(express.json({ limit: '16kb' }));

    app.use(session({
        secret: process.env.SECRET || 'hivemind-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: 'auto',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    }));

    /* ---------- Routes ---------- */

    app.get('/healthz', (req, res) => {
        res.json({
            status: 'ok',
            word: app.locals.word,
            day: app.locals.currentDay,
            totalGuesses: app.locals.totalGuesses,
            uniqueWords: Object.keys(app.locals.guessCounts || {}).length,
            scheduled: (app.locals.wordSchedules || []).length,
            archived: (app.locals.history || []).length,
            uptimeSec: Math.round((Date.now() - app.locals.startedAt.getTime()) / 1000)
        });
    });

    app.use(apiRoutes);
    app.use(gameRoutes);
    app.use(adminRoutes);

    // 404
    app.use((req, res) => {
        res.status(404).type('text/plain').send('Not found');
    });

    // Centralized error handler
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        console.error('[error]', err && err.stack ? err.stack : err);
        if (res.headersSent) return;
        res.status(500).type('text/plain').send('Internal server error');
    });

    /* ---------- Daily reset cron ---------- */

    const dailyResetJob = cron.schedule('0 0 * * *', () => {
        console.log('[cron] daily reset');
        archiveCurrentDay(app.locals);
        resetDailyCounters(app.locals);
        if (!app.locals.wordSchedules.length) {
            app.locals.word = 'Spring';
        }
        app.locals.markDirty();
    }, { timezone: 'UTC' });

    /* ---------- Server lifecycle ---------- */

    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
        console.log(`Hivemind server listening on port ${port}`);
    });

    let shuttingDown = false;
    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[shutdown] received ${signal}, flushing state…`);

        try { dailyResetJob.stop(); } catch (_) { /* ignore */ }
        try { wordSchedule.stopAll(); } catch (_) { /* ignore */ }
        try { persistence.flush(app.locals); } catch (e) {
            console.error('[shutdown] flush failed:', e.message);
        }

        server.close(() => {
            console.log('[shutdown] http server closed');
            process.exit(0);
        });

        // Hard timeout so we never hang
        setTimeout(() => {
            console.warn('[shutdown] forcing exit');
            process.exit(1);
        }, 5000).unref();
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return { app, server };
}

module.exports = dashboardInit;
