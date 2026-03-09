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

        let passengersList = '';
        passengers_data.forEach((p, idx) => {
            passengersList += `\n${idx + 1}. ${p.firstName} ${p.lastName} (${p.documentType} ${p.documentNumber})`;
        });

        const ticketMsg = `🎫 <b>ЭЛЕКТРОННЫЙ БИЛЕТ НА АВТОБУС</b> 🎫\n\n` +
            `✅ <b>Статус:</b> Забронировано\n` +
            `🚌 <b>Рейс:</b> ${ticket.from_city} ➡ ${ticket.to_city}\n` +
            `🗓 <b>Дата и время:</b> ${dateStr} в ${timeStr}\n\n` +
            `📞 <b>Покупатель:</b> ${phone}\n` +
            `💺 <b>Количество мест:</b> ${seat_numbers.length} (Места: ${seat_numbers.join(', ')})\n` +
            `👥 <b>Пассажиры:</b>${passengersList}\n\n` +
            `💰 <b>Общая стоимость:</b> ${totalPrice} сом\n\n` +
            `<i>Пожалуйста, сохраните этот билет. Счастливого пути!</i>`;

        sendPersonalMessage(passenger_id, ticketMsg);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
