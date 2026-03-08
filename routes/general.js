const express = require('express');
const router = express.Router();
const supabase = require('../db');

/**
 * @swagger
 * /api/cities:
 *   get:
 *     summary: Get list of available cities
 *     tags: [General]
 */
router.get('/cities', async (req, res) => {
    try {
        const { data: cities, error } = await supabase
            .from('cities')
            .select('name')
            .order('name', { ascending: true });

        if (error) throw error;

        res.json((cities || []).map(c => c.name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
