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
                passenger_name: b.passenger_name || b.users?.name,
                passenger_phone: b.users?.phone || b.phone,
                seat_numbers: typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : b.seat_numbers,
                passengers_data: typeof b.passengers_data === 'string' ? JSON.parse(b.passengers_data || '[]') : b.passengers_data,
                ticket_context: ticket ? `${ticket.from_city} -> ${ticket.to_city} (${ticket.departure_date})` : 'Unknown'
            };
        })

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-admin/tickets/{id}:
 *   put:
 *     summary: Update a bus ticket
 *     tags: [Bus Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.put('/tickets/:id', async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove id from updateData to prevent primary key update issues
    delete updateData.id;
    delete updateData.created_at;

    try {
        const { error } = await supabase
            .from('bus_tickets')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-admin/tickets/{id}:
 *   delete:
 *     summary: Delete a bus ticket
 *     tags: [Bus Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.delete('/tickets/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { error } = await supabase
            .from('bus_tickets')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/bus-admin/bookings/manual:
 *   post:
 *     summary: Create a manual booking (by operator)
 *     tags: [Bus Admin]
 */
router.post('/bookings/manual', async (req, res) => {
    const { bus_ticket_id, operator_id, seat_numbers, passengers_data, phone, passenger_name } = req.body;

    try {
        const { data: ticket, error: tErr } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('id', bus_ticket_id)
            .single();

        if (tErr) throw tErr;

        // Check if seats are already taken
        const reserved = typeof ticket.reserved_seats === 'string' ? JSON.parse(ticket.reserved_seats || '[]') : (ticket.reserved_seats || []);
        const conflict = seat_numbers.some(s => reserved.includes(s));
        if (conflict) return res.status(400).json({ error: 'Seats already taken' });

        // Insert booking
        const { data: booking, error: bErr } = await supabase
            .from('bus_ticket_bookings')
            .insert([{
                bus_ticket_id,
                passenger_id: operator_id, // Managed by operator
                seat_numbers,
                passenger_count: seat_numbers.length,
                passengers_data,
                phone,
                status: 'confirmed',
                total_price: 0, // Manual booking
                passenger_name: passenger_name // Store name for table display
            }])
            .select('id')
            .single();

        if (bErr) throw bErr;

        // Update ticket reserved seats
        const newReserved = [...reserved, ...seat_numbers];
        await supabase
            .from('bus_tickets')
            .update({ reserved_seats: newReserved })
            .eq('id', bus_ticket_id);

        res.json({ success: true, id: booking.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
