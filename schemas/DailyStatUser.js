const mongoose = require('mongoose');

const DailyStatsUserSchema = new mongoose.Schema({
    date: { type: Date, required: true },
    userId: { type: String, required: false },
    guess: { type: String, required: true },
});

module.exports = mongoose.model('dailystatsusers', DailyStatsUserSchema);