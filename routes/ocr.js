const express = require('express');
const router = express.Router();
const axios = require('axios');
const { uploadToCloudinary } = require('../utils/cloudinaryUtils');

// IMPORTANT: Replace with actual key or move to .env
const OCR_API_KEY = process.env.OCR_API_KEY || 'nkIXg5z3fkwFdApQB1lVYVheMn9XkYXr';
const OCR_API_URL = 'https://api.100ocrapi.com/v1/passport';

/**
 * @swagger
 * /api/ocr/passport:
 *   post:
 *     summary: Extract passport data from image
 *     tags: [OCR]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 description: Base64 encoded image string
 */
router.post('/passport', async (req, res) => {
    const { image } = req.body;

    if (!image) {
        return res.status(400).json({ error: 'Image is required' });
    }

    try {
        console.log('[OCR] Uploading passport image to Cloudinary...');
        // 1. Upload to Cloudinary
        const cloudinaryResult = await uploadToCloudinary(image, {
            folder: 'poputki/passports',
            tags: ['passport', 'ocr']
        });

        console.log('[OCR] Image uploaded to Cloudinary:', cloudinaryResult.url);

        // 2. Call 100OCRAPI
        console.log('[OCR] Calling 100OCRAPI...');
        const ocrResponse = await axios.post(OCR_API_URL, {
            image: cloudinaryResult.url
        }, {
            headers: {
                'apikey': OCR_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const data = ocrResponse.data;
        console.log('[OCR] 100OCRAPI raw response:', JSON.stringify(data));

        // 3. Map to our passenger format
        // Typical 100OCRAPI response fields: first_name, last_name, date_of_birth, passport_number, sex, nationality
        // Mapping may need adjustment based on actual API response structure
        const result = {
            firstName: data.first_name || '',
            lastName: data.last_name || '',
            middleName: data.middle_name || '',
            birthDate: data.date_of_birth ? data.date_of_birth.replace(/\//g, '-') : '', // Convert YYYY/MM/DD to YYYY-MM-DD
            docNumber: data.passport_number || '',
            gender: data.sex === 'M' || data.sex === 'male' ? 'male' : (data.sex === 'F' || data.sex === 'female' ? 'female' : ''),
            citizenship: data.nationality || 'Таджикистан'
        };

        res.json(result);
    } catch (err) {
        console.error('[OCR] Error:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Failed to process passport',
            details: err.response?.data || err.message
        });
    }
});

module.exports = router;
