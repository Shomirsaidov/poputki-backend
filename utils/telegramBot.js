const axios = require('axios');
const supabase = require('../db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8669833278:AAFHxzU9jZUZIWVrHdogUsYrkQmd_F05MZA';
const BROADCAST_GROUP_ID = process.env.TELEGRAM_BROADCAST_GROUP_ID; // The ID of the group where the bot broadcasts new rides
const BOT_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BOT_LINK = 'https://t.me/poputkionline_bot'; // Or t.me/poputkionline_bot, must be valid URL for inline keyboard

/**
 * Sends a message to a Telegram chat.
 * @param {string|number} chatId - The Telegram chat ID to send the message to.
 * @param {string} text - The message text (supports MarkdownV2 or HTML depending on parseMode).
 * @param {object} [options] - Optional configurations (e.g., inline keyboards).
 */
async function sendMessage(chatId, text, options = {}) {
    if (!chatId) {
        console.error('Telegram Bot: Missing chatId');
        return false;
    }

    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            ...options
        };

        const response = await axios.post(`${BOT_API_URL}/sendMessage`, payload);
        return response.data;
    } catch (error) {
        console.error(`Telegram Bot Error (chatId: ${chatId}):`, error.response?.data?.description || error.message);
        return false;
    }
}

/**
 * Broadcasts a message to all configured Telegram groups, appending standard inline buttons linking to the bot/app.
 * @param {string} text - HTML formatted message text.
 * @param {number|string} [rideId] - Optional ID of the ride to link directly to it.
 */
async function sendBroadcast(text, rideId = null) {
    // Fetch all saved groups from our database
    const { data: groups, error } = await supabase
        .from('telegram_groups')
        .select('chat_id');

    if (error || !groups || groups.length === 0) {
        console.log('Telegram Bot: No groups found in database to broadcast to.');
        return false;
    }

    const inlineKeyboard = [];

    const appUrl = process.env.MINI_APP_URL || 'https://poputki.online';

    if (rideId) {
        inlineKeyboard.push([
            { text: 'Подробнее', url: `${appUrl}/ride/${rideId}` }
        ]);
    }

    inlineKeyboard.push([
        { text: 'Открыть приложение', url: 'https://t.me/poputkionline_bot' }
    ]);

    const options = {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };

    // Send the message to all saved groups concurrently
    const broadcastPromises = groups.map(group =>
        sendMessage(group.chat_id, text, options)
    );

    await Promise.all(broadcastPromises);
    return true;
}

/**
 * Sends a direct/personal message to a user based on their ID in our database.
 * Fetches the user's `telegram_id` from Supabase before sending.
 * @param {string|number} userId - The user's internal ID in the Supabase `users` table.
 * @param {string} text - HTML formatted message text.
 */
async function sendPersonalMessage(userId, text) {
    if (!userId) return false;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('telegram_id')
            .eq('id', userId)
            .single();

        if (error) {
            console.error(`Telegram Bot: Could not find user ${userId} for personal message`, error.message);
            return false;
        }

        if (!user.telegram_id) {
            console.log(`Telegram Bot: User ${userId} does not have a connected Telegram account.`);
            return false;
        }

        return await sendMessage(user.telegram_id, text);
    } catch (error) {
        console.error('Telegram Bot Personal Message Error:', error.message);
        return false;
    }
}

module.exports = {
    sendMessage,
    sendBroadcast,
    sendPersonalMessage
};
