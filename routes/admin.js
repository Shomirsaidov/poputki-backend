const express = require('express');
const router = express.Router();
const supabase = require('../db');

const ADMIN_PASSCODE = '941206'; // Tricky 6-digit code
const ADMIN_SECRET_TOKEN = 'poputki-admin-super-secret-token-2026';

// Middleware to verify admin token
function adminAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (token === ADMIN_SECRET_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Admin access required' });
    }
}

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Administrative operations
 */

// Admin Login
router.post('/login', (req, res) => {
    const { passcode } = req.body;
    console.log(`[Admin Login Attempt] Passcode received: ${passcode ? '***' + passcode.slice(-2) : 'NONE'}`);
    
    if (String(passcode) === String(ADMIN_PASSCODE)) {
        console.log(`[Admin Login Success] Standard passcode used`);
        res.json({ token: ADMIN_SECRET_TOKEN });
    } else {
        console.warn(`[Admin Login Failure] Invalid passcode`);
        res.status(401).json({ error: 'Неверный код доступа' });
    }
});

// Protect all following routes
router.use(adminAuth);

// Dashboard Stats
router.get('/stats', async (req, res) => {
    try {
        const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: totalRides } = await supabase.from('rides').select('*', { count: 'exact', head: true });
        const { count: activeRides } = await supabase.from('rides').select('*', { count: 'exact', head: true }).eq('status', 'active');
        const { count: totalBusTickets } = await supabase.from('bus_tickets').select('*', { count: 'exact', head: true });
        const { count: activeBusTickets } = await supabase.from('bus_tickets').select('*', { count: 'exact', head: true }).eq('status', 'active');
        const { count: totalBusBookings } = await supabase.from('bus_ticket_bookings').select('*', { count: 'exact', head: true });
        const { count: totalReviews } = await supabase.from('reviews').select('*', { count: 'exact', head: true });

        const { data: busBookingsRevenue } = await supabase.from('bus_ticket_bookings').select('total_price').eq('status', 'confirmed');
        const revenue = (busBookingsRevenue || []).reduce((acc, curr) => acc + (curr.total_price || 0), 0);

        // Detailed stats
        const { data: recentUsers } = await supabase
            .from('users')
            .select('id, name, created_at')
            .order('created_at', { ascending: false })
            .limit(5);

        // popularDestinations: requires grouped queries that aren't perfectly supported out of the box in PostgREST without RPC
        const { data: allRides } = await supabase.from('rides').select('to_city');
        const destinationCounts = (allRides || []).reduce((acc, curr) => {
            if (curr.to_city) {
                acc[curr.to_city] = (acc[curr.to_city] || 0) + 1;
            }
            return acc;
        }, {});
        const popularDestinations = Object.keys(destinationCounts)
            .map(city => ({ to_city: city, count: destinationCounts[city] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // popularBusRoutes
        const { data: allBusTickets } = await supabase.from('bus_tickets').select('from_city, to_city');
        const busRouteCounts = (allBusTickets || []).reduce((acc, curr) => {
            const route = `${curr.from_city} → ${curr.to_city}`;
            acc[route] = (acc[route] || 0) + 1;
            return acc;
        }, {});
        const popularBusRoutes = Object.keys(busRouteCounts)
            .map(route => ({ route, count: busRouteCounts[route] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Stats for Charts
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateString = sevenDaysAgo.toISOString().split('T')[0];

        const { data: ridesLast7DaysRaw } = await supabase
            .from('rides')
            .select('date')
            .gte('date', dateString);

        const ridesLast7DaysMap = (ridesLast7DaysRaw || []).reduce((acc, curr) => {
            if (curr.date) {
                acc[curr.date] = (acc[curr.date] || 0) + 1;
            }
            return acc;
        }, {});
        const ridesLast7Days = Object.keys(ridesLast7DaysMap)
            .map(date => ({ date, count: ridesLast7DaysMap[date] }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const { data: busTicketsLast7DaysRaw } = await supabase
            .from('bus_tickets')
            .select('departure_date')
            .gte('departure_date', dateString);

        const busTicketsLast7DaysMap = (busTicketsLast7DaysRaw || []).reduce((acc, curr) => {
            if (curr.departure_date) {
                acc[curr.departure_date] = (acc[curr.departure_date] || 0) + 1;
            }
            return acc;
        }, {});
        const busTicketsLast7Days = Object.keys(busTicketsLast7DaysMap)
            .map(date => ({ date, count: busTicketsLast7DaysMap[date] }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const { data: usersLast7DaysRaw } = await supabase
            .from('users')
            .select('created_at')
            .gte('created_at', dateString);

        const usersLast7DaysMap = (usersLast7DaysRaw || []).reduce((acc, curr) => {
            if (curr.created_at) {
                const date = curr.created_at.split('T')[0];
                acc[date] = (acc[date] || 0) + 1;
            }
            return acc;
        }, {});
        const usersLast7Days = Object.keys(usersLast7DaysMap)
            .map(register_date => ({ register_date, count: usersLast7DaysMap[register_date] }))
            .sort((a, b) => a.register_date.localeCompare(b.register_date));

        // Global Booking Dynamics (Bus only, last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDateString = thirtyDaysAgo.toISOString().split('T')[0];

        const { data: busBookings } = await supabase
            .from('bus_ticket_bookings')
            .select('created_at, status, total_price')
            .gte('created_at', thirtyDateString);
        
        const bookingMap = {};
        let paidCount = 0;
        let manualCount = 0;
        let totalCount = 0;

        (busBookings || []).forEach(b => {
            const d = b.created_at.split('T')[0];
            bookingMap[d] = (bookingMap[d] || 0) + 1;
            
            if (b.status !== 'cancelled') {
                totalCount++;
                if (b.total_price === 0) {
                    manualCount++;
                } else if (b.status === 'confirmed') {
                    paidCount++;
                }
            }
        });

        const bookingDynamics = Object.keys(bookingMap)
            .map(date => ({ date, count: bookingMap[date] }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const bookingStatusDistribution = {
            total: totalCount,
            paid: paidCount,
            manual: manualCount,
            other: totalCount - paidCount - manualCount
        };

        // Age Distribution
        const { data: userAges } = await supabase.from('users').select('age');
        const ageBins = { '18-25': 0, '26-35': 0, '36-45': 0, '46-60': 0, '60+': 0, 'Unknown': 0 };
        (userAges || []).forEach(u => {
            if (!u.age) ageBins['Unknown']++;
            else if (u.age <= 25) ageBins['18-25']++;
            else if (u.age <= 35) ageBins['26-35']++;
            else if (u.age <= 45) ageBins['36-45']++;
            else if (u.age <= 60) ageBins['46-60']++;
            else ageBins['60+']++;
        });
        const ageDistribution = Object.keys(ageBins).map(label => ({ label, count: ageBins[label] }));

        // Car Model Distribution
        const { data: carModels } = await supabase.from('vehicles').select('model');
        const modelCounts = (carModels || []).reduce((acc, curr) => {
            if (curr.model) {
                const model = curr.model.trim();
                acc[model] = (acc[model] || 0) + 1;
            }
            return acc;
        }, {});
        const carModelDistribution = Object.keys(modelCounts)
            .map(model => ({ model, count: modelCounts[model] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const stats = {
            totalUsers,
            totalRides,
            activeRides,
            totalBusTickets,
            activeBusTickets,
            totalBusBookings,
            totalReviews,
            revenue,
            recentUsers,
            popularDestinations,
            popularBusRoutes,
            ridesLast7Days,
            busTicketsLast7Days,
            usersLast7Days,
            bookingDynamics,
            bookingStatusDistribution,
            ageDistribution,
            carModelDistribution
        };

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// User Management
router.get('/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('id, name, surname, phone, rating, created_at, role, age, sex, photo_url, username, is_blocked')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        await supabase.from('users').delete().eq('id', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/users/:id', async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bus Drivers Management
router.get('/bus-drivers', async (req, res) => {
    try {
        const { data: drivers, error } = await supabase
            .from('users')
            .select('id, name, surname, phone, created_at, service_fee_percent, is_blocked')
            .eq('role', 'bus_driver')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(drivers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update service fee percent for a specific bus driver
router.put('/bus-drivers/:id/fee', async (req, res) => {
    const { id } = req.params;
    const { service_fee_percent } = req.body;

    if (service_fee_percent === undefined || service_fee_percent === null) {
        return res.status(400).json({ error: 'service_fee_percent is required' });
    }
    const fee = parseFloat(service_fee_percent);
    if (isNaN(fee) || fee < 0 || fee > 100) {
        return res.status(400).json({ error: 'service_fee_percent must be between 0 and 100' });
    }

    try {
        const { error } = await supabase
            .from('users')
            .update({ service_fee_percent: fee })
            .eq('id', id)
            .eq('role', 'bus_driver');
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Block a bus driver
router.put('/bus-drivers/:id/block', async (req, res) => {
    try {
        const { error } = await supabase
            .from('users')
            .update({ is_blocked: true })
            .eq('id', req.params.id)
            .eq('role', 'bus_driver');
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Unblock a bus driver
router.put('/bus-drivers/:id/unblock', async (req, res) => {
    try {
        const { error } = await supabase
            .from('users')
            .update({ is_blocked: false })
            .eq('id', req.params.id)
            .eq('role', 'bus_driver');
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/bus-drivers', async (req, res) => {
    const { phone, name, surname, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    try {
        const { data: existing } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
        if (existing) {
            return res.status(400).json({ error: 'Пользователь с таким номером уже существует' });
        }

        const { error } = await supabase
            .from('users')
            .insert([{ phone, name, surname, password, role: 'bus_driver' }]);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ride Management
router.get('/rides', async (req, res) => {
    try {
        const { data: rides, error } = await supabase
            .from('rides')
            .select('*, users:driver_id (name)')
            .order('id', { ascending: false });
        if (error) throw error;

        const formattedRides = rides.map(r => {
            const userData = r.users || {};
            delete r.users;
            return {
                ...r,
                driver_name: userData.name,
                time: r.time ? r.time.substring(0, 5) : r.time
            };
        });

        res.json(formattedRides);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/rides/:id', async (req, res) => {
    try {
        await supabase.from('rides').delete().eq('id', req.params.id);
        await supabase.from('bookings').delete().eq('ride_id', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/rides/:id', async (req, res) => {
    try {
        const { data: ride, error } = await supabase
            .from('rides')
            .update(req.body)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        res.json(ride);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// City Management
router.get('/cities', async (req, res) => {
    const { type } = req.query;
    try {
        let query = supabase
            .from('cities')
            .select('*')
            .order('name', { ascending: true });
        
        if (type) {
            query = query.eq('type', type);
        }

        const { data: cities, error } = await query;
        if (error) throw error;
        console.log(`[Admin] Fetched ${cities?.length} cities`);
        res.json(cities);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/cities', async (req, res) => {
    const { name, type } = req.body;
    try {
        const { error } = await supabase.from('cities').insert([{ name, type: type || 'ride' }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/cities/:id', async (req, res) => {
    try {
        await supabase.from('cities').delete().eq('id', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bus Ticket Management
router.get('/bus-tickets', async (req, res) => {
    try {
        const { data: tickets, error } = await supabase
            .from('bus_tickets')
            .select('*')
            .order('departure_date', { ascending: false });
        if (error) throw error;
        const formatted = tickets.map(t => ({
            ...t,
            departure_time: t.departure_time ? t.departure_time.substring(0, 5) : t.departure_time,
            arrival_time: t.arrival_time ? t.arrival_time.substring(0, 5) : t.arrival_time
        }));
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/bus-tickets/:id', async (req, res) => {
    try {
        await supabase.from('bus_tickets').delete().eq('id', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Review Moderation
router.get('/reviews', async (req, res) => {
    try {
        const { data: reviews, error } = await supabase
            .from('reviews')
            .select('*, u1:reviewer_id(name), u2:driver_id(name)')
            .order('created_at', { ascending: false });
        if (error) throw error;

        const formattedReviews = reviews.map(r => {
            const reviewerName = r.u1 ? r.u1.name : null;
            const driverName = r.u2 ? r.u2.name : null;
            delete r.u1;
            delete r.u2;
            return {
                ...r,
                reviewer_name: reviewerName,
                driver_name: driverName
            };
        });

        res.json(formattedReviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/reviews/:id', async (req, res) => {
    try {
        await supabase.from('reviews').delete().eq('id', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all bookings for a specific bus ticket (admin drill-down)
router.get('/bus-tickets/:id/bookings', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: bookings, error } = await supabase
            .from('bus_ticket_bookings')
            .select(`
                id, bus_ticket_id, passenger_id, seat_numbers, passenger_count, passengers_data, phone, status, total_price, passenger_name, pickup_city, drop_off_city, created_at,
                users:passenger_id (name, phone)
            `)
            .eq('bus_ticket_id', id)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const result = (bookings || []).map(b => ({
            ...b,
            passenger_name: b.passenger_name || b.users?.name,
            passenger_phone: b.users?.phone || b.phone,
            seat_numbers: typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []),
            passengers_data: typeof b.passengers_data === 'string' ? JSON.parse(b.passengers_data || '[]') : (b.passengers_data || [])
        }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all bus tickets (rides) for a specific bus driver (admin drill-down)
router.get('/bus-drivers/:id/tickets', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: tickets, error } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('operator_id', id)
            .order('departure_date', { ascending: false });

        if (error) throw error;

        // Fetch confirmed bookings to compute actual reserved seats
        const ticketIds = (tickets || []).map(t => t.id);
        const { data: allBookings } = ticketIds.length > 0
            ? await supabase
                .from('bus_ticket_bookings')
                .select('bus_ticket_id, seat_numbers')
                .in('bus_ticket_id', ticketIds)
                .eq('status', 'confirmed')
            : { data: [] };

        const result = (tickets || []).map(t => {
            const ticketBookings = (allBookings || []).filter(b => b.bus_ticket_id === t.id);
            const reservedSeats = [];
            ticketBookings.forEach(b => {
                const seats = typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []);
                reservedSeats.push(...seats);
            });
            return {
                ...t,
                reserved_seats: reservedSeats,
                reserved_count: reservedSeats.length,
                free_seats: t.total_seats - reservedSeats.length,
                intermediate_stops: typeof t.intermediate_stops === 'string'
                    ? JSON.parse(t.intermediate_stops || '[]')
                    : (t.intermediate_stops || []),
                departure_time: t.departure_time ? t.departure_time.substring(0, 5) : t.departure_time,
                arrival_time: t.arrival_time ? t.arrival_time.substring(0, 5) : t.arrival_time,
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

