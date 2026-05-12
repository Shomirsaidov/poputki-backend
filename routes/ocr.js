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
        // 1. Strip the Data URI prefix to get raw base64
        // Input: "data:image/jpeg;base64,/9j/4AAQ..."  →  Output: "/9j/4AAQ..."
        const base64Data = image.includes(',') ? image.split(',')[1] : image;

        // 2. Upload to Cloudinary for storage
        console.log('[OCR] Uploading passport image to Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(image, {
            folder: 'poputki/passports',
            tags: ['passport', 'ocr']
        });
        console.log('[OCR] Image uploaded to Cloudinary:', cloudinaryResult.url);

        // 3. Call 100OCRAPI with raw base64 (form-urlencoded)
        console.log('[OCR] Calling 100OCRAPI...');
        const ocrResponse = await axios.post(OCR_API_URL,
            `img=${encodeURIComponent(base64Data)}`,
            {
                headers: {
                    'X-API-Key': OCR_API_KEY,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const data = ocrResponse.data;
        console.log('[OCR] 100OCRAPI raw response:', JSON.stringify(data));

        // 4. Check for API errors
        if (data.status !== 'OK') {
            console.error('[OCR] API returned error status:', data.status, data.message);
            return res.status(400).json({
                error: 'OCR recognition failed',
                details: data.message || data.status
            });
        }

        // 5. Map response to our passenger format
        // API response: { status: "OK", message: { passportNumber, name, gender, birthDay, nationality, ... } }
        const msg = data.message;

        // Parse full name — API returns "LASTNAME FIRSTNAME" or "LASTNAME, FIRSTNAME"
        let lastName = '';
        let firstName = '';
        if (msg.name) {
            const nameParts = msg.name.replace(',', '').trim().split(/\s+/);
            lastName = nameParts[0] || '';
            firstName = nameParts.slice(1).join(' ') || '';
        }

        // Parse birthDay from "YYYYMMDD" → "YYYY-MM-DD"
        let birthDate = '';
        if (msg.birthDay && msg.birthDay.length === 8) {
            birthDate = `${msg.birthDay.slice(0, 4)}-${msg.birthDay.slice(4, 6)}-${msg.birthDay.slice(6, 8)}`;
        }

        const result = {
            firstName,
            lastName,
            middleName: '',
            birthDate,
            docNumber: msg.passportNumber || '',
            gender: msg.gender === 'M' ? 'male' : (msg.gender === 'F' ? 'female' : ''),
            citizenship: msg.nationality || 'Таджикистан'
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
