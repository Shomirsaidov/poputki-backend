const express = require('express');
const router = express.Router();
const supabase = require('../db');

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
            user.isNew = !user.name; // user is new if they haven't completed profile
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
    const { id, first_name, last_name, username, photo_url } = req.body;

    if (!id || !first_name) {
        return res.status(400).json({ error: 'Telegram ID and first_name are required' });
    }

    try {
        const fullName = last_name ? `${first_name} ${last_name}` : first_name;

        // Check if user exists by telegram_id
        let { data: user, error: findError } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', id)
            .maybeSingle();

        if (findError) throw findError;

        if (user) {
            // Update existing user's Telegram info
            const { data: updatedUser, error: updateError } = await supabase
                .from('users')
                .update({
                    photo_url: photo_url || user.photo_url,
                    username: username || user.username,
                    name: user.name || fullName // Only update name if it was empty
                })
                .eq('id', user.id)
                .select()
                .single();

            if (updateError) throw updateError;
            user = { ...updatedUser, isNew: !updatedUser.phone }; // It's "new" if they lack a phone number, which is needed for core app functions
        } else {
            // Create new user
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                    telegram_id: id,
                    name: fullName,
                    username: username,
                    photo_url: photo_url,
                    role: 'passenger'
                }])
                .select()
                .single();

            if (insertError) throw insertError;
            user = { ...newUser, isNew: true };
        }

        res.json({ user, token: 'tg-token-' + user.id });
    } catch (err) {
        console.error("Telegram Login Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
