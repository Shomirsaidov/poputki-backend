const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendBroadcast } = require('../utils/telegramBot');

/**
 * @swagger
 * components:
 *   schemas:
 *     BusTicket:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         operator_id:
 *           type: integer
 *         transport_company:
 *           type: string
 *         from_city:
 *           type: string
 *         from_address:
 *           type: string
 *         to_city:
 *           type: string
 *         to_address:
 *           type: string
 *         departure_date:
 *           type: string
 *         departure_time:
 *           type: string
 *         arrival_date:
 *           type: string
 *         arrival_time:
 *           type: string
 *         duration_minutes:
 *           type: integer
 *         price:
 *           type: integer
 *         total_seats:
 *           type: integer
 *         status:
 *           type: string
 */

/**
 * @swagger
 * /api/bus-tickets:
 *   post:
 *     summary: Create a bus ticket
 *     tags: [Bus Tickets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BusTicket'
 */
router.post('/', async (req, res) => {
    const {
        operator_id, transport_company,
        from_city, from_address, to_city, to_address,
        departure_date, departure_time, arrival_date, arrival_time,
        duration_minutes, price, total_seats,
        bus_type, passenger_comments, intermediate_stops
    } = req.body;
    try {
        const { data: ticket, error } = await supabase
            .from('bus_tickets')
            .insert([{
                operator_id, transport_company,
                from_city, from_address, to_city, to_address,
                departure_date, departure_time, arrival_date, arrival_time,
                duration_minutes, price, total_seats: total_seats || 44,
                reserved_seats: [], status: 'active',
                bus_type: bus_type || 'single', passenger_comments,
                intermediate_stops: intermediate_stops || []
            }])
            .select('id')
            .single();

        if (error) throw error;

        res.json({ id: ticket.id, ...req.body });

        // Telegram Notifications
        const dateStr = departure_date;
        const timeStr = departure_time ? departure_time.substring(0, 5) : '';
        const broadcastMsg = `🚌 НОВЫЙ АВТОБУСНЫЙ РЕЙС\n📍 Маршрут: ${from_city} ➡ ${to_city}\n🗓 Дата: ${dateStr}\n⏰ Время: ${timeStr}\n💰 Цена: ${price} сом\n🏢 Перевозчик: ${transport_company}`;
        sendBroadcast(broadcastMsg);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-tickets:
 *   get:
 *     summary: Search bus tickets
 *     tags: [Bus Tickets]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 */
router.get('/', async (req, res) => {
    const { from, to, date } = req.query;
    try {
        let query = supabase
            .from('bus_tickets')
            .select('*')
            .eq('status', 'active')
            .order('id', { ascending: false });

        if (from) query = query.ilike('from_city', `%${from}%`);
        if (to) query = query.ilike('to_city', `%${to}%`);
        if (date) query = query.gte('departure_date', date);

        const { data: tickets, error } = await query;
        if (error) throw error;

        const result = tickets.map(t => ({
            ...t,
            reserved_seats: typeof t.reserved_seats === 'string' ? JSON.parse(t.reserved_seats || '[]') : (t.reserved_seats || []),
            departure_time: t.departure_time ? t.departure_time.substring(0, 5) : t.departure_time,
            arrival_time: t.arrival_time ? t.arrival_time.substring(0, 5) : t.arrival_time
        }));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-tickets/{id}:
 *   get:
 *     summary: Get bus ticket details
 *     tags: [Bus Tickets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/:id', async (req, res) => {
    try {
        const { data: ticket, error: ticketError } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (ticketError || !ticket) return res.status(404).json({ error: 'Ticket not found' });

        ticket.reserved_seats = typeof ticket.reserved_seats === 'string' ? JSON.parse(ticket.reserved_seats || '[]') : (ticket.reserved_seats || []);
        ticket.intermediate_stops = (typeof ticket.intermediate_stops === 'string' ? JSON.parse(ticket.intermediate_stops || '[]') : (ticket.intermediate_stops || [])).map(s => ({
            ...s,
            time: s.time ? s.time.substring(0, 5) : s.time
        }));
        ticket.departure_time = ticket.departure_time ? ticket.departure_time.substring(0, 5) : ticket.departure_time;
        ticket.arrival_time = ticket.arrival_time ? ticket.arrival_time.substring(0, 5) : ticket.arrival_time;

        const { data: bookings, error: bookingsError } = await supabase
            .from('bus_ticket_bookings')
            .select('*')
            .eq('bus_ticket_id', ticket.id)
            .eq('status', 'confirmed');

        if (bookingsError) throw bookingsError;

        const bookedSeats = [];
        const seatGenders = {};

        (bookings || []).forEach(b => {
            const seats = typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []);
            const pData = typeof b.passengers_data === 'string' ? JSON.parse(b.passengers_data || '[]') : (b.passengers_data || []);

            bookedSeats.push(...seats);
            seats.forEach((seatNum, idx) => {
                if (pData[idx] && pData[idx].gender) {
                    seatGenders[seatNum] = pData[idx].gender;
                }
            });
        });

        res.json({ ...ticket, bookings, bookedSeats, seatGenders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
