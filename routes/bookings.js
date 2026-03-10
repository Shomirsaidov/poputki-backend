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

            const { data: userData } = await supabase
                .from('users')
                .select('name, phone')
                .eq('id', passenger_id)
                .single();

            if (rideData && userData) {
                const dateStr = rideData.date;
                const timeStr = rideData.time ? rideData.time.substring(0, 5) : '';

                // Notify passenger
                const passMsg = `✅ <b>Бронирование подтверждено!</b>\n\n🚗 <b>Маршрут:</b> ${rideData.from_city} ➡ ${rideData.to_city}\n🗓 <b>Дата:</b> ${dateStr}\n⏰ <b>Время:</b> ${timeStr}\n💺 <b>Место:</b> ${seat_number}\n\n<i>Водитель уведомлен. Приятной поездки!</i>`;
                const rideUrl = `${process.env.MINI_APP_URL || 'https://poputki.online'}/ride/${ride_id}`;
                const options = {
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Открыть поездку', url: rideUrl }]]
                    }
                };
                sendPersonalMessage(passenger_id, passMsg, options);

                // Notify driver
                const driverMsg = `🔔 <b>Новая заявка на поездку!</b>\n\n🧑‍💻 <b>Пассажир:</b> ${userData.name}\n📞 <b>Телефон:</b> ${userData.phone || 'Не указан'}\n💺 <b>Выбранное место:</b> ${seat_number}\n\n📍 <b>Маршрут:</b> ${rideData.from_city} ➡ ${rideData.to_city}\n🗓 <b>Дата:</b> ${dateStr} в ${timeStr}`;
                const optionsDriver = {
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Открыть поездку', url: rideUrl }]]
                    }
                };
                sendPersonalMessage(rideData.driver_id, driverMsg, optionsDriver);
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

        if (deleteError) throw deleteError;

        // Fetch passenger details for notification
        const { data: passengerData } = await supabase
            .from('users')
            .select('name, phone')
            .eq('id', booking.passenger_id)
            .single();

        res.json({ success: true });

        // Telegram Notifications
        const dateStr = rideData.date;
        const timeStr = rideData.time ? rideData.time.substring(0, 5) : '';
        const passengerName = passengerData ? passengerData.name : 'Пассажир';
        const passengerPhone = passengerData ? (passengerData.phone ? `+${passengerData.phone}` : 'Не указан') : 'Не указан';

        const rideUrl = `${process.env.MINI_APP_URL || 'https://poputki.online'}/ride/${booking.ride_id}`;
        const options = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Открыть поездку', url: rideUrl }]]
            }
        };

        const cancelMsg = `⚠️ <b>ОТМЕНА БРОНИРОВАНИЯ</b>\n\n` +
            `👤 <b>Пассажир:</b> ${passengerName}\n` +
            `📞 <b>Телефон:</b> ${passengerPhone}\n` +
            `💺 <b>Место:</b> ${booking.seat_number}\n\n` +
            `📍 <b>Маршрут:</b> ${rideData.from_city} ➡ ${rideData.to_city}\n` +
            `🗓 <b>Дата:</b> ${dateStr} в ${timeStr}\n\n` +
            `<i>Место снова доступно для других попутчиков.</i>`;

        sendPersonalMessage(rideData.driver_id, cancelMsg, options);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// I'll put bus bookings in busTickets.js or a separate file.
// Let's move bus bookings to busTickets.js as well.
// Re-writing busTickets.js to include bookings.

module.exports = router;
