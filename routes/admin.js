const express = require('express');
const router = express.Router();
const supabase = require('../db');

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Administrative operations
 */

// Dashboard Stats
router.get('/stats', async (req, res) => {
    try {
        const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: totalRides } = await supabase.from('rides').select('*', { count: 'exact', head: true });
        const { count: activeRides } = await supabase.from('rides').select('*', { count: 'exact', head: true }).eq('status', 'active');
        const { count: totalBusBookings } = await supabase.from('bus_ticket_bookings').select('*', { count: 'exact', head: true });
        const { count: totalReviews } = await supabase.from('reviews').select('*', { count: 'exact', head: true });

        const { data: busBookingsRevenue } = await supabase.from('bus_ticket_bookings').select('total_price');
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

        // Vehicle Distribution
        const { data: userVehicles } = await supabase
            .from('users')
            .select('id, vehicles(id)');

        let withVehicle = 0;
        let noVehicle = 0;
        (userVehicles || []).forEach(u => {
            if (u.vehicles && u.vehicles.length > 0) {
                withVehicle++;
            } else {
                noVehicle++;
            }
        });
        const vehicleDistribution = [
            { status: 'with_vehicle', count: withVehicle },
            { status: 'no_vehicle', count: noVehicle }
        ];

        const stats = {
            totalUsers,
            totalRides,
            activeRides,
            totalBusBookings,
            totalReviews,
            revenue,
            recentUsers,
            popularDestinations,
            ridesLast7Days,
            usersLast7Days,
            vehicleDistribution
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
            .select('*')
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
            .select('id, name, surname, phone, created_at')
            .eq('role', 'bus_driver')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(drivers);
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
    try {
        const { data: cities, error } = await supabase
            .from('cities')
            .select('*')
            .order('name', { ascending: true });
        if (error) throw error;
        console.log(`[Admin] Fetched ${cities?.length} cities`);
        res.json(cities);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/cities', async (req, res) => {
    const { name } = req.body;
    try {
        const { error } = await supabase.from('cities').insert([{ name }]);
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

module.exports = router;
