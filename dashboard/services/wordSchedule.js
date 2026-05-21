/**
 * Word-schedule service.
 *
 * Wraps node-cron and exposes add / remove / restoreAll operations against
 * `app.locals.wordSchedules`. Schedules are validated to "HH:mm" UTC.
 */

const cron = require('node-cron');

const SCHEDULE_TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function parseHHmm(time) {
    const matches = String(time || '').trim().match(SCHEDULE_TIME_PATTERN);
    if (!matches) return null;

    const hour = parseInt(matches[1], 10);
    const minute = parseInt(matches[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    return { hour, minute, normalized: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function createWordScheduleService(app, { onChange = () => {} } = {}) {
    const jobs = new Map();

    function scheduleJob(entry) {
        const job = cron.schedule(entry.cron, () => {
            app.locals.word = entry.word;
            console.log(`[schedule] word change → "${entry.word}" at ${entry.time} UTC`);
            onChange();
        }, { timezone: 'UTC' });

        jobs.set(entry.id, job);
    }

    function add(word, time) {
        const parsed = parseHHmm(time);
        if (!parsed) return null;

        const cleanedWord = String(word || '').trim();
        if (!cleanedWord) return null;

        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            word: cleanedWord,
            time: parsed.normalized,
            cron: `${parsed.minute} ${parsed.hour} * * *`
        };

        app.locals.wordSchedules.push(entry);
        scheduleJob(entry);
        onChange();
        return entry;
    }

    function remove(scheduleId) {
        const index = app.locals.wordSchedules.findIndex((entry) => entry.id === scheduleId);
        if (index === -1) return false;

        const job = jobs.get(scheduleId);
        if (job) {
            job.stop();
            jobs.delete(scheduleId);
        }

        app.locals.wordSchedules.splice(index, 1);
        onChange();
        return true;
    }

    function restoreAll(entries) {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (entry && entry.id && entry.cron && entry.word && entry.time) {
                app.locals.wordSchedules.push(entry);
                scheduleJob(entry);
            }
        }
    }

    function stopAll() {
        for (const job of jobs.values()) {
            job.stop();
        }
        jobs.clear();
    }

    return { add, remove, restoreAll, stopAll };
}

module.exports = { createWordScheduleService };
