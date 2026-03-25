const express = require('express');
const router = express.Router();
const supabase = require('../db');
const crypto = require('crypto');

// Professional Telegram initData verification
// Hardcoded Bot Token to ensure consistency across services
const BOT_TOKEN = '8669833278:AAFHxzU9jZUZIWVrHdogUsYrkQmd_F05MZA';

function verifyTelegramData(initData) {
    if (!initData) return false;

    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const sortedKeys = Array.from(urlParams.keys()).sort();
        const dataCheckString = sortedKeys
            .map(key => `${key}=${urlParams.get(key)}`)
            .join('\n');

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const generatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        return generatedHash === hash;
    } catch (e) {
        console.error('Telegram sync verification error:', e);
        return false;
    }
}

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login or Register user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [passenger, driver]
 *                 description: Required for new registration
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                 token:
 *                   type: string
 *       400:
 *         description: Phone missing
 */
router.post('/login', async (req, res) => {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    // Normalize phone (digits only + optional start plus)
    phone = phone.replace(/[^\d+]/g, '');

    try {
        let { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('phone', phone)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "Results contain 0 rows"
            throw error;
        }

        if (!user) {
            // Create skeleton user
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{ phone }])
                .select()
                .single();

            if (insertError) throw insertError;
            user = { ...newUser, isNew: true };
        } else {
            user.isNew = !user.phone || !user.age || !user.name || user.age <= 0; // user is new if they haven't completed profile
        }
        res.json({ user, token: 'mock-token-' + user.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Complete user profile registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - name
 *               - age
 *             properties:
 *               id:
 *                 type: integer
 *               name:
 *                 type: string
 *               surname:
 *                 type: string
 *               age:
 *                 type: integer
 *               sex:
 *                 type: string
 *     responses:
 *       200:
 *         description: Registration successful
 *       500:
 *         description: Server error
 */
router.post('/register', async (req, res) => {
    const { id, name, age, phone } = req.body;
    try {
        const updateData = { name, age };

        if (phone) {
            updateData.phone = phone.replace(/[^\d+]/g, '');
        }

        const { data: user, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/auth/bus-login:
 *   post:
 *     summary: Login for Bus Drivers
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - password
 *             properties:
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 */
router.post('/bus-login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('phone', phone)
            .eq('password', password)
            .eq('role', 'bus_driver')
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Неверный телефон, пароль или нет прав водителя автобуса' });
        }

        res.json({ user, token: 'bus-token-' + user.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/auth/telegram-login:
 *   post:
 *     summary: Login or Register user via Telegram Mini App
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - first_name
 *             properties:
 *               id:
 *                 type: integer
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               username:
 *                 type: string
 *               photo_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/telegram-login', async (req, res) => {
    const { id, first_name, last_name, username, photo_url, userId, initData } = req.body;

    if (!id || !first_name) {
        return res.status(400).json({ error: 'Telegram ID and first_name are required' });
    }

    // Professional Verification
    if (initData && !verifyTelegramData(initData)) {
        console.error("Telegram Data Verification Failed for ID:", id);
        return res.status(403).json({ error: 'Invalid Telegram data' });
    }

    console.log(`Telegram Login request for ID: ${id}, Name: ${first_name}, userId: ${userId}`);

    try {
        const fullName = last_name ? `${first_name} ${last_name}` : first_name;
        let user;

        // Step 1: Check if this telegram_id already exists in our DB
        const { data: existingTgUser } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', id)
            .maybeSingle();

        if (userId) {
            // We want to link the TG account to an existing profile (usually logged in via phone)
            if (existingTgUser) {
                if (existingTgUser.id !== parseInt(userId)) {
                    // Conflict: This TG account is already linked to another DB user
                    // If the existing linked user is just a skeleton (no phone), we can merge/transfer
                    if (!existingTgUser.phone) {
                        // Delete the skeleton TG user
                        await supabase.from('users').delete().eq('id', existingTgUser.id);
                        // Now update the current user (phone user) with the TG info
                        const { data: updatedUser, error: updateError } = await supabase
                            .from('users')
                            .update({
                                telegram_id: id,
                                username: username || null,
                                photo_url: photo_url || null,
                                name: fullName
                            })
                            .eq('id', userId)
                            .select()
                            .single();

                        if (updateError) {
                            console.error("Error updating user with TG info (merge):", updateError);
                            throw updateError;
                        }
                        user = updatedUser;
                    } else {
                        // Existing user has a phone! This is a real conflict. 
                        // Just use the existing user instead of linking to the new one?
                        // For now, prioritize the account that already has the phone.
                        user = existingTgUser;
                    }
                } else {
                    // Already linked correctly, just update info
                    const { data: updatedUser, error: updateError } = await supabase
                        .from('users')
                        .update({
                            username: username || existingTgUser.username,
                            photo_url: photo_url || existingTgUser.photo_url,
                            name: existingTgUser.name || fullName
                        })
                        .eq('id', userId)
                        .select()
                        .single();

                    if (updateError) {
                        console.error("Error updating existing linked user:", updateError);
                        throw updateError;
                    }
                    user = updatedUser;
                }
            } else {
                // Link new TG account to existing phone user
                const { data: updatedUser, error: updateError } = await supabase
                    .from('users')
                    .update({
                        telegram_id: id,
                        username: username || null,
                        photo_url: photo_url || null,
                        name: fullName
                    })
                    .eq('id', userId)
                    .select()
                    .single();

                if (updateError) {
                    console.error("Error linking TG to user:", updateError);
                    throw updateError;
                }
                user = updatedUser;
            }
        } else {
            // No userId provided, just find or create by telegram_id
            if (existingTgUser) {
                // Update existing user's Telegram info
                const { data: updatedUser, error: updateError } = await supabase
                    .from('users')
                    .update({
                        username: username || existingTgUser.username,
                        photo_url: photo_url || existingTgUser.photo_url,
                        name: existingTgUser.name || fullName
                    })
                    .eq('id', existingTgUser.id)
                    .select()
                    .single();

                if (updateError) {
                    console.error("Error updating existing TG user:", updateError);
                    throw updateError;
                }
                user = updatedUser;
            } else {
                // Create new user from TG info
                const { data: newUser, error: insertError } = await supabase
                    .from('users')
                    .insert([{
                        telegram_id: id,
                        username: username,
                        name: fullName,
                        photo_url: photo_url,
                        role: 'passenger'
                    }])
                    .select()
                    .single();

                if (insertError) {
                    console.error("Error creating new TG user:", insertError);
                    throw insertError;
                }
                user = newUser;
            }
        }

        // Set isNew flag if they haven't provided enough info yet (name, age, phone)
        user.isNew = !user.phone || !user.age || !user.name || user.age <= 0;

        res.json({ user, token: 'tg-token-' + user.id });
    } catch (err) {
        console.error("Telegram Login Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
