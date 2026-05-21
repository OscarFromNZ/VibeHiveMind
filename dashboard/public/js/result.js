/* =========================================================
   HIVEMIND // result page client script
   - Stamps issue number, filed date, subscriber number
   - Rotates the daily proverb (stable per UTC day) with drop-cap
   - Echoes the user's guess as a "catchword" leaf-mark
   - Animates the revelation numbers like a press odometer
   - Wires the Copy Clipping button
   Data is read from a <script type="application/json" id="result-data"> block
   emitted by the EJS template: { scoreMessage: string, guess: string }
   ========================================================= */

(function () {
    function readResultData() {
        const el = document.getElementById('result-data');
        if (!el) return { scoreMessage: '', guess: '' };
        try {
            return JSON.parse(el.textContent || '{}');
        } catch (e) {
            return { scoreMessage: '', guess: '' };
        }
    }

    const DATA = readResultData();

    const QUOTES = [
        { q: 'A ship in harbour is safe, but that is not what a ship is for.',                                  by: 'proverb' },
        { q: 'A mill cannot grind with the water that is past.',                                                by: 'english proverb' },
        { q: 'A new language is a new life.',                                                                   by: 'persian proverb' },
        { q: 'Calm seas never made a good sailor.',                                                             by: 'proverb' },
        { q: 'Cheese, wine, and friends must be old to be good.',                                               by: 'proverb' },
        { q: 'Coffee and love taste best when hot.',                                                            by: 'ethiopian proverb' },
        { q: 'Cross the stream where it is shallowest.',                                                        by: 'proverb' },
        { q: 'Before setting out on a mission of vengeance, dig two graves.',                                   by: 'proverb' },
        { q: 'Even from a foe a man may learn wisdom.',                                                         by: 'proverb' },
        { q: 'From its fruit the tree is known.',                                                               by: 'luke 6:44' },
        { q: 'From the sublime to the ridiculous there is but a step.',                                         by: 'napoleon, attributed' },
        { q: 'He who knows does not speak. He who speaks does not know.',                                       by: 'laozi' },
        { q: 'Islands depend on reeds, just as reeds depend on islands.',                                       by: 'burmese proverb' },
        { q: 'Kindness in words creates confidence. Kindness in giving creates love.',                          by: 'laozi' },
        { q: 'Memory is the treasure of the mind.',                                                             by: 'proverb' },
        { q: 'Old sins cast long shadows.',                                                                     by: 'proverb' },
        { q: 'One kind word can warm three winter months.',                                                     by: 'japanese proverb' },
        { q: 'Rain does not fall on one roof alone.',                                                           by: 'cameroonian proverb' },
        { q: 'Shiny are the distant hills.',                                                                    by: 'proverb' },
        { q: 'Shrouds have no pockets.',                                                                        by: 'proverb' },
        { q: 'Sit crooked and talk straight.',                                                                  by: 'armenian proverb' },
        { q: 'Slow is smooth, smooth is fast.',                                                                 by: 'proverb' },
        { q: 'Talk of angels, and hear the flutter of their wings.',                                            by: 'proverb' },
        { q: 'The longest journey starts with a single step.',                                                  by: 'laozi' },
        { q: 'There is no shame in not knowing; the shame lies in not finding out.',                            by: 'proverb' },
        { q: 'Time goes by slowly when you are living intensely.',                                              by: 'proverb' },
        { q: 'To be worn out is to be renewed.',                                                                by: 'laozi' },
        { q: 'Truth is more valuable if it takes you a few years to find it.',                                  by: 'jules renard' },
        { q: 'Turn your face toward the sun and the shadows fall behind you.',                                  by: 'maori proverb' },
        { q: 'Until the lions have their historians, tales of the hunt shall always glorify the hunter.',       by: 'igbo proverb' },
        { q: 'Walnuts and pears you plant for your heirs.',                                                     by: 'proverb' },
        { q: 'Zeal without knowledge is fire without light.',                                                   by: 'thomas fuller, 1732' }
    ];

    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function stampIssueAndDate() {
        const d = new Date();
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
        const dayOfYear = Math.floor((d - yearStart) / 86400000);

        setText('issue-no', 'Issue №' + String(dayOfYear).padStart(3, '0'));
        setText(
            'filed-date',
            String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()]
        );

        return dayOfYear;
    }

    function renderDailyQuote(dayOfYear) {
        const qEl = document.getElementById('daily-quote');
        const byEl = document.getElementById('daily-quote-by');
        if (!qEl) return;

        const pick = QUOTES[dayOfYear % QUOTES.length];
        const firstChar = pick.q.charAt(0);
        const rest = pick.q.slice(1);
        qEl.innerHTML = '<span class="dropcap">' + firstChar + '</span>' + rest;
        if (byEl) byEl.textContent = pick.by;
    }

    function stampSubscriberNumber() {
        const el = document.getElementById('sub-no');
        if (!el) return;
        try {
            const uid = localStorage.getItem('userId') || '';
            let h = 0;
            for (let i = 0; i < uid.length; i++) {
                h = (h * 31 + uid.charCodeAt(i)) >>> 0;
            }
            el.textContent = '№' + (h % 9999).toString().padStart(4, '0');
        } catch (e) {
            el.textContent = '№————';
        }
    }

    function stampCatchword() {
        const cw = document.getElementById('catchword');
        if (!cw) return;
        const guess = String(DATA.guess || '').toUpperCase();
        cw.textContent = guess + ' · cont.';
    }

    function animateRevelations() {
        document.querySelectorAll('.revelation-value').forEach(function (el, i) {
            const raw = el.textContent.trim();
            const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
            if (!m) return;

            const target = parseFloat(m[1]);
            const suffix = m[2] || '';
            const decimals = (m[1].split('.')[1] || '').length;
            const duration = 900;
            const startAt = performance.now() + 850 + i * 200;

            el.textContent = (0).toFixed(decimals) + suffix;

            function tick(now) {
                if (now < startAt) {
                    requestAnimationFrame(tick);
                    return;
                }
                const t = Math.min(1, (now - startAt) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                el.textContent = (target * eased).toFixed(decimals) + suffix;
                if (t < 1) requestAnimationFrame(tick);
            }

            requestAnimationFrame(tick);
        });
    }

    function wireCopyButton() {
        const btn = document.querySelector('.btn-copy');
        if (!btn) return;

        btn.addEventListener('click', function () {
            const text = DATA.scoreMessage || '';
            if (!text || !navigator.clipboard) return;

            navigator.clipboard.writeText(text).then(function () {
                const original = btn.textContent;
                btn.textContent = '✓ Clipped';
                setTimeout(function () { btn.textContent = original; }, 1500);
            });
        });
    }

    function startNextEditionCountdown() {
        const el = document.getElementById('next-edition');
        if (!el) return;

        const initial = Number(DATA.nextResetMs);
        if (!Number.isFinite(initial) || initial <= 0) {
            el.textContent = 'next edition imminent';
            return;
        }

        const target = Date.now() + initial;
        function tick() {
            const remaining = Math.max(0, target - Date.now());
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const hh = String(hours).padStart(2, '0');
            const mm = String(minutes).padStart(2, '0');
            const ss = String(seconds).padStart(2, '0');
            el.textContent = 'next edition in ' + hh + ':' + mm + ':' + ss;
            if (remaining <= 0) {
                el.textContent = 'next edition imminent';
                return;
            }
            setTimeout(tick, 1000);
        }
        tick();
    }

    const dayOfYear = stampIssueAndDate();
    renderDailyQuote(dayOfYear);
    stampSubscriberNumber();
    stampCatchword();
    animateRevelations();
    wireCopyButton();
    startNextEditionCountdown();
})();
