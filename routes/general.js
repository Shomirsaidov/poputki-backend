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
    const { type } = req.query;
    try {
        let query = supabase
            .from('cities')
            .select('name')
            .order('name', { ascending: true });
        
        if (type) {
            query = query.eq('type', type);
        }

        const { data: cities, error } = await query;

        if (error) throw error;

        res.json((cities || []).map(c => c.name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
