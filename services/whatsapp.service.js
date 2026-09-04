const axios = require('axios');

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'verification_code';

const isConfigured = () => Boolean(TOKEN && PHONE_NUMBER_ID);

const formatPhone = (raw) => {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (trimmed.startsWith('+')) return trimmed.slice(1); // Meta API prefers no + prefix
    const digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('971')) return digits;
    if (digits.startsWith('0')) return '971' + digits.slice(1);
    return digits;
};

/**
 * Send OTP via Meta WhatsApp Business API
 * @param {string} phone - Target phone number
 * @param {string} code - The 6-digit OTP code
 */
exports.sendOtp = async (phone, code) => {
    if (!isConfigured()) throw new Error('WhatsApp service not configured');

    const to = formatPhone(phone);
    if (!to) throw new Error('Invalid phone number');

    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    // For testing purposes with the 'hello_world' template which doesn't support variables
    console.log(`[WhatsApp OTP] Sending code ${code} to ${to} (Template: ${TEMPLATE_NAME})`);

    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "template",
        template: {
            name: TEMPLATE_NAME,
            language: {
                code: "en_US"
            }
        }
    };

    // Only add components if we are NOT using the static hello_world template
    if (TEMPLATE_NAME !== 'hello_world') {
        data.template.components = [
            {
                type: "body",
                parameters: [
                    {
                        type: "text",
                        text: code
                    }
                ]
            },
            {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                    {
                        type: "text",
                        text: code
                    }
                ]
            }
        ];
    }

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('WhatsApp API Error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || 'Failed to send WhatsApp message');
    }
};

exports.isConfigured = isConfigured;
exports.formatPhone = (phone) => {
    // Return with + for UI display
    const digits = formatPhone(phone);
    return digits ? '+' + digits : null;
};
