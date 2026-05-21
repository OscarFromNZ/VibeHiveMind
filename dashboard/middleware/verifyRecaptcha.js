require('dotenv').config();

const recaptchaSecret = process.env.RECAPTCHA_SECRET;
const recaptchaVerifyURL = process.env.RECAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify';

const axios = require('axios').create({ timeout: 5000 });

async function verifyRecaptcha(recaptchaResponse) {
    if (!recaptchaResponse) {
        return false;
    }

    try {
        const { data } = await axios.post(recaptchaVerifyURL, null, {
            params: { secret: recaptchaSecret, response: recaptchaResponse }
        });
        return data && data.success === true;
    } catch (error) {
        console.error('reCAPTCHA error:', error.message || error);
        return false;
    }
}

module.exports = verifyRecaptcha;