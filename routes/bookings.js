const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendPersonalMessage } = require('../utils/telegramBot');

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     summary: Book a seat in a ride
 *     tags: [Bookings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ride_id:
 *                 type: integer
 *               passenger_id:
 *                 type: integer
 *               seat_number:
 *                 type: integer
 *               passenger_gender:
 *                 type: string
 */
router.post('/', async (req, res) => {
    const { ride_id, passenger_id, seat_number, passenger_gender } = req.body;

    if (!seat_number) {
        return res.status(400).json({ error: 'Seat number is required' });
    }

    try {
        const { data: existingBooking } = await supabase
            .from('bookings')
            .select('*')
            .eq('ride_id', ride_id)
            .eq('seat_number', seat_number)
            .maybeSingle();

        if (existingBooking) {
            return res.status(400).json({ error: 'Seat already booked' });
        }

        const { data: booking, error } = await supabase
            .from('bookings')
            .insert([{ ride_id, passenger_id, seat_number, passenger_gender }])
            .select('id')
            .single();

        if (error) throw error;

        res.json({ id: booking.id, status: 'confirmed' });

        // Telegram Notifications
        try {
            const { data: rideData } = await supabase
                .from('rides')
                .select('driver_id, from_city, to_city, date, time')
                .eq('id', ride_id)
                .single();

            if (rideData) {
                const dateStr = rideData.date;
                const timeStr = rideData.time ? rideData.time.substring(0, 5) : '';

                // Notify passenger
                sendPersonalMessage(passenger_id, `✅ Вы успешно забронировали место на поездку <b>${rideData.from_city} - ${rideData.to_city}</b> на ${dateStr} в ${timeStr}.`);

                // Notify driver
                sendPersonalMessage(rideData.driver_id, `🔔 Новая бронь!\nМесто: ${seat_number}\nПоездка: <b>${rideData.from_city} - ${rideData.to_city}</b> на ${dateStr} в ${timeStr}.`);
            }
        } catch (e) {
            console.error('Telegram Bookings Error:', e);
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-ticket-bookings:
 *   post:
 *     summary: Book bus seats
 *     tags: [Bookings]
 */
router.post('/bus', (req, res) => {
    // Note: Mount this at /api/bus-ticket-bookings in index.js
});

/**
 * @swagger
 * /api/bookings/{id}/cancel:
 *   post:
 *     summary: Cancel a booking (passenger side)
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.post('/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const { passenger_id } = req.body;

    try {
        const { data: booking, error } = await supabase
            .from('bookings')
            .select(`
                *,
                rides:ride_id (driver_id, from_city, to_city, date, time, status)
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!booking || booking.passenger_id !== passenger_id) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        const rideData = booking.rides;

        if (rideData.status === 'completed') {
            return res.status(400).json({ error: 'Cannot cancel booking for a completed ride' });
        }

        const time = rideData.time ? rideData.time : '00:00:00';
        const rideDateTime = new Date(`${rideData.date}T${time}`);

        if (new Date() >= rideDateTime) {
            return res.status(400).json({ error: 'Нельзя отменить бронь после начала поездки' });
        }

        const { error: deleteError } = await supabase
            .from('bookings')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({ success: true });

        // Telegram Notifications
        const dateStr = rideData.date;
        const timeStr = rideData.time ? rideData.time.substring(0, 5) : '';
        sendPersonalMessage(rideData.driver_id, `⚠️ Пассажир отменил бронь (Место ${booking.seat_number}) на поездку <b>${rideData.from_city} - ${rideData.to_city}</b> на ${dateStr} в ${timeStr}.`);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// I'll put bus bookings in busTickets.js or a separate file.
// Let's move bus bookings to busTickets.js as well.
// Re-writing busTickets.js to include bookings.

module.exports = router;
