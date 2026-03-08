const express = require('express');
const router = express.Router();
const supabase = require('../db');

/**
 * @swagger
 * tags:
 *   name: Bus Admin
 *   description: Operations for Bus Drivers Panel
 */

/**
 * @swagger
 * /api/bus-admin/tickets:
 *   get:
 *     summary: Get tickets created by the bus operator
 *     tags: [Bus Admin]
 *     parameters:
 *       - in: query
 *         name: operator_id
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/tickets', async (req, res) => {
    const { operator_id } = req.query;
    if (!operator_id) return res.status(400).json({ error: 'operator_id required' });

    try {
        const { data: tickets, error } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('operator_id', operator_id)
            .order('departure_date', { ascending: false });

        if (error) throw error;

        const result = tickets.map(t => ({
            ...t,
            reserved_seats: typeof t.reserved_seats === 'string' ? JSON.parse(t.reserved_seats || '[]') : (t.reserved_seats || []),
            intermediate_stops: (typeof t.intermediate_stops === 'string' ? JSON.parse(t.intermediate_stops || '[]') : (t.intermediate_stops || [])).map(s => ({
                ...s,
                time: s.time ? s.time.substring(0, 5) : s.time
            })),
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
 * /api/bus-admin/bookings:
 *   get:
 *     summary: Get bookings on tickets owned by operator
 *     tags: [Bus Admin]
 *     parameters:
 *       - in: query
 *         name: operator_id
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/bookings', async (req, res) => {
    const { operator_id } = req.query;
    if (!operator_id) return res.status(400).json({ error: 'operator_id required' });

    try {
        // Find tickets for this operator
        const { data: tickets, error: tErr } = await supabase
            .from('bus_tickets')
            .select('id, from_city, to_city, departure_date, departure_time')
            .eq('operator_id', operator_id);

        if (tErr) throw tErr;
        const ticketIds = tickets.map(t => t.id);

        if (ticketIds.length === 0) return res.json([]);

        // Get bookings for these tickets
        const { data: bookings, error: bErr } = await supabase
            .from('bus_ticket_bookings')
            .select(`
                *,
                users:passenger_id (name, phone)
            `)
            .in('bus_ticket_id', ticketIds)
            .order('created_at', { ascending: false });

        if (bErr) throw bErr;

        const result = bookings.map(b => {
            const ticket = tickets.find(t => t.id === b.bus_ticket_id);
            return {
                ...b,
                passenger_name: b.users?.name,
                passenger_phone: b.users?.phone || b.phone,
                seat_numbers: typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : b.seat_numbers,
                passengers_data: typeof b.passengers_data === 'string' ? JSON.parse(b.passengers_data || '[]') : b.passengers_data,
                ticket_context: ticket ? `${ticket.from_city} -> ${ticket.to_city} (${ticket.departure_date})` : 'Unknown'
            };
        }).map(b => { delete b.users; return b; });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
