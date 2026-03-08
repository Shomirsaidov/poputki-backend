const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendPersonalMessage } = require('../utils/telegramBot');

/**
 * @swagger
 * /api/bus-ticket-bookings:
 *   post:
 *     summary: Book bus seats (multi-passenger)
 *     tags: [Bus Tickets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bus_ticket_id:
 *                 type: integer
 *               passenger_id:
 *                 type: integer
 *               seat_numbers:
 *                 type: array
 *                 items:
 *                   type: integer
 *               passengers_data:
 *                 type: array
 *                 items:
 *                   type: object
 *               phone:
 *                 type: string
 */
router.post('/', async (req, res) => {
    const { bus_ticket_id, passenger_id, seat_numbers, passengers_data, phone } = req.body;
    if (!seat_numbers || !seat_numbers.length) {
        return res.status(400).json({ error: 'Seat numbers required' });
    }
    if (!passengers_data || !passengers_data.length) {
        return res.status(400).json({ error: 'Passenger data required' });
    }

    try {
        const { data: ticket, error: ticketError } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('id', bus_ticket_id)
            .single();

        if (ticketError || !ticket) return res.status(404).json({ error: 'Ticket not found' });

        const { data: existingBookings } = await supabase
            .from('bus_ticket_bookings')
            .select('seat_numbers')
            .eq('bus_ticket_id', bus_ticket_id)
            .eq('status', 'confirmed');

        const takenSeats = [];
        (existingBookings || []).forEach(b => {
            const seats = typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []);
            takenSeats.push(...seats);
        });

        const conflict = seat_numbers.some(s => takenSeats.includes(s));
        if (conflict) return res.status(400).json({ error: 'Одно или несколько мест уже заняты' });

        const totalPrice = ticket.price * seat_numbers.length;

        const { data: booking, error: insertError } = await supabase
            .from('bus_ticket_bookings')
            .insert([{
                bus_ticket_id,
                passenger_id,
                seat_numbers: seat_numbers,
                passenger_count: seat_numbers.length,
                passengers_data: passengers_data,
                phone,
                status: 'confirmed',
                total_price: totalPrice
            }])
            .select('id')
            .single();

        if (insertError) throw insertError;

        const allTakenSeats = [...takenSeats, ...seat_numbers];
        await supabase
            .from('bus_tickets')
            .update({ reserved_seats: allTakenSeats })
            .eq('id', bus_ticket_id);

        res.json({ id: booking.id, status: 'confirmed', total_price: totalPrice });

        // Telegram Notifications
        const dateStr = ticket.departure_date;
        const timeStr = ticket.departure_time ? ticket.departure_time.substring(0, 5) : '';
        sendPersonalMessage(passenger_id, `✅ Вы успешно забронировали билеты на автобус <b>${ticket.from_city} - ${ticket.to_city}</b> на ${dateStr} в ${timeStr}.\nМеста: ${seat_numbers.join(', ')}\nК оплате: ${totalPrice} сом.`);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
