/* =========================================================
   HIVEMIND // game page client script
   - Stamps the issue number (day-of-year) into the masthead
   - Stamps a stable per-device subscriber number (if rendered)
   - On submit, attaches a persistent userId from localStorage
   ========================================================= */

(function () {
    const d = new Date();
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
    const dayOfYear = Math.floor((d - start) / 86400000);

    const issueEl = document.getElementById('issue-no');
    if (issueEl) {
        issueEl.textContent = 'Issue №' + String(dayOfYear).padStart(3, '0');
    }

    const subEl = document.getElementById('sub-no');
    if (subEl) {
        try {
            const uid = localStorage.getItem('userId') || '';
            let h = 0;
            for (let i = 0; i < uid.length; i++) {
                h = (h * 31 + uid.charCodeAt(i)) >>> 0;
            }
            const subNo = (h % 9999).toString().padStart(4, '0');
            subEl.textContent = '№' + subNo;
        } catch (e) {
            subEl.textContent = '№————';
        }
    }
})();

document.addEventListener('DOMContentLoaded', function () {
    function getOrCreateUserId() {
        let userId = localStorage.getItem('userId');
        if (!userId) {
            userId = 'user-' + crypto.randomUUID();
            localStorage.setItem('userId', userId);
        }
        return userId;
    }

    const form = document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const userIdInput = document.createElement('input');
        userIdInput.type = 'hidden';
        userIdInput.name = 'userId';
        userIdInput.value = getOrCreateUserId();
        form.appendChild(userIdInput);
        form.submit();
    });
});
