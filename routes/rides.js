const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendBroadcast, sendPersonalMessage } = require('../utils/telegramBot');

/**
 * @swagger
 * components:
 *   schemas:
 *     Ride:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         driver_id:
 *           type: integer
 *         from_city:
 *           type: string
 *         to_city:
 *           type: string
 *         date:
 *           type: string
 *         time:
 *           type: string
 *         price:
 *           type: integer
 *         seats:
 *           type: integer
 *         description:
 *           type: string
 *         is_passenger_entry:
 *           type: boolean
 *         allows_delivery:
 *           type: boolean
 *         status:
 *           type: string
 *         from_address:
 *           type: string
 *         to_address:
 *           type: string
 *         total_seats:
 *           type: integer
 */

/**
 * @swagger
 * /api/rides:
 *   get:
 *     summary: Search for rides
 *     tags: [Rides]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *         description: Origin city
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *         description: Destination city
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         description: Date of ride
 *       - in: query
 *         name: all_status
 *         schema:
 *           type: boolean
 *         description: Include all ride statuses
 *     responses:
 *       200:
 *         description: List of rides
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Ride'
 */

router.get('/check-limit', async (req, res) => {
    const { driver_id } = req.query;
    if (!driver_id) return res.status(400).json({ error: 'Missing driver_id' });
    
    try {
        const { data: activeRides } = await supabase
            .from('rides')
            .select('date, time')
            .eq('driver_id', driver_id)
            .eq('status', 'active')
            .eq('is_passenger_entry', false);

        const futureActiveRides = (activeRides || []).filter(ride => {
            const t = ride.time ? ride.time : '00:00:00';
            const rideDateTime = new Date(`${ride.date}T${t}`);
            return new Date() < rideDateTime;
        });

        res.json({ 
            exceedsLimit: futureActiveRides.length >= 2, 
            count: futureActiveRides.length 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', async (req, res) => {
    const { from, to, date, all_status } = req.query;
    try {
        let query = supabase
            .from('rides')
            .select(`
                *,
                users:driver_id (name, rating, phone)
            `)
            .order('id', { ascending: false });

        if (!all_status) {
            // Because Supabase considers NULL equal to nothing in .eq(), we use .or()
            query = query.or('status.eq.active,status.is.null');
        }

        if (from) query = query.ilike('from_city', `%${from}%`);
        if (to) query = query.ilike('to_city', `%${to}%`);
        if (date) query = query.gte('date', date);

        const { data: rides, error } = await query;
        if (error) throw error;

        // Flatten the relations
        const formattedRides = rides.map(r => {
            const userData = r.users || {};
            delete r.users;
            return {
                ...r,
                driver_name: userData.name,
                driver_rating: userData.rating,
                driver_phone: userData.phone,
                time: r.time ? r.time.substring(0, 5) : r.time
            };
        });

        res.json(formattedRides);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides/{id}:
 *   get:
 *     summary: Get ride details
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Ride details
 *       404:
 *         description: Ride not found
 */
router.get('/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const { data: rideRaw, error: rideError } = await supabase
            .from('rides')
            .select(`
                *,
                users:driver_id (name, rating, phone, preferences)
            `)
            .eq('id', id)
            .single();

        if (rideError || !rideRaw) return res.status(404).json({ error: 'Ride not found' });

        const userData = rideRaw.users || {};
        delete rideRaw.users;

        const ride = {
            ...rideRaw,
            driver_name: userData.name,
            driver_rating: userData.rating,
            driver_phone: userData.phone,
            driver_preferences: typeof userData.preferences === 'string' ? JSON.parse(userData.preferences || '[]') : (userData.preferences || []),
            time: rideRaw.time ? rideRaw.time.substring(0, 5) : rideRaw.time
        };

        if (!ride.total_seats && !ride.is_passenger_entry) {
            const { data: v } = await supabase
                .from('vehicles')
                .select('total_seats')
                .eq('user_id', ride.driver_id)
                .maybeSingle();
            ride.total_seats = v ? v.total_seats : 5;
        } else if (!ride.total_seats) {
            ride.total_seats = 5;
        }

        ride.reserved_seats = typeof ride.reserved_seats === 'string' ? JSON.parse(ride.reserved_seats || '[]') : (ride.reserved_seats || []);
        ride.row_prices = typeof ride.row_prices === 'string' ? JSON.parse(ride.row_prices || '{}') : (ride.row_prices || {});

        let vehicle = null;
        if (!ride.is_passenger_entry) {
            const { data: vData } = await supabase
                .from('vehicles')
                .select('make, model, plate_number')
                .eq('user_id', ride.driver_id)
                .maybeSingle();
            vehicle = vData;
        }

        const { data: bookingsRaw, error: bookingsError } = await supabase
            .from('bookings')
            .select(`
                *,
                users:passenger_id (name, age)
            `)
            .eq('ride_id', id);

        if (bookingsError) throw bookingsError;

        const bookings = (bookingsRaw || []).map(b => {
            const pData = b.users || {};
            delete b.users;
            return {
                ...b,
                passenger_name: pData.name,
                age: pData.age
            };
        });

        res.json({ ...ride, vehicle, bookings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides:
 *   post:
 *     summary: Create a new ride
 *     tags: [Rides]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Ride'
 *     responses:
 *       200:
 *         description: Ride created
 *       400:
 *         description: Bad request
 */
router.post('/', async (req, res) => {
    const { driver_id, from_city, to_city, date, time, price, seats, description, is_passenger_entry, reserved_seats, allows_delivery, from_address, to_address, total_seats, row_prices } = req.body;
    console.log(`[Ride Creation] Attempting to create ride for driver_id: ${driver_id}`);

    try {
        // Verify user exists to avoid foreign key violation (common after DB reset)
        const { data: userExists, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('id', driver_id)
            .maybeSingle();

        if (userError || !userExists) {
            console.error(`[Ride Creation] Driver ${driver_id} not found in database.`);
            return res.status(401).json({ error: 'Приложение работает правильно в телеграм боте' });
        }

        const { data: activeRides } = await supabase
            .from('rides')
            .select('date, time')
            .eq('driver_id', driver_id)
            .eq('status', 'active')
            .eq('is_passenger_entry', false);

        const futureActiveRides = (activeRides || []).filter(ride => {
            const t = ride.time ? ride.time : '00:00:00';
            const rideDateTime = new Date(`${ride.date}T${t}`);
            return new Date() < rideDateTime;
        });

        console.log(`[Ride Creation] driver_id: ${driver_id}, is_passenger_entry: ${is_passenger_entry}, futureActiveRides: ${futureActiveRides.length}`);

        if (futureActiveRides.length >= 2 && !is_passenger_entry) {
            return res.status(400).json({ error: 'У вас уже есть 2 активных рейса в будущем. Завершите их, чтобы создать новый.' });
        }

        if (!is_passenger_entry && price) {
            const isKhujandDushanbe = (from_city === 'Худжанд' && to_city === 'Душанбе') || (from_city === 'Душанбе' && to_city === 'Худжанд');
            const isKhujandOybek = (from_city === 'Худжанд' && to_city === 'Ойбек') || (from_city === 'Ойбек' && to_city === 'Худжанд');

            if (isKhujandDushanbe && price > 150) {
                return res.status(400).json({ error: `Для маршрута ${from_city} - ${to_city} максимальная цена составляет 150 с.` });
            }
            if (isKhujandOybek && price > 60) {
                return res.status(400).json({ error: `Для маршрута ${from_city} - ${to_city} максимальная цена составляет 60 с.` });
            }

            if (row_prices) {
                const maxAllowed = isKhujandDushanbe ? 150 : (isKhujandOybek ? 60 : Infinity);
                const rPrices = Object.values(row_prices).filter(p => !isNaN(p) && p !== null);
                if (rPrices.some(p => p > maxAllowed)) {
                    return res.status(400).json({ error: `Цена по одному из рядов превышает максимум (${maxAllowed} с.)` });
                }
            }
        }

        const { data: ride, error } = await supabase
            .from('rides')
            .insert([{
                driver_id,
                from_city,
                to_city,
                date,
                time,
                price,
                seats,
                description,
                is_passenger_entry: !!is_passenger_entry,
                reserved_seats: reserved_seats || [],
                allows_delivery: !!allows_delivery,
                status: 'active',
                from_address,
                to_address,
                total_seats: total_seats || 5,
                row_prices: row_prices || {}
            }])
            .select('id')
            .single();

        if (error) throw error;

        res.json({ id: ride.id, ...req.body });

        // Telegram Notifications
        const dateStr = date;
        const timeStr = time ? time.substring(0, 5) : '';

        if (is_passenger_entry) {
            const broadcastMsg = `🙋 ПАССАЖИР ИЩЕТ ПОЕЗДКУ\n📍 Маршрут: ${from_city} ➡ ${to_city}\n🗓 Дата: ${dateStr}\n⏰ Время: ${timeStr}`;
            console.log(`[Ride Creation] Broadcasting passenger entry: ${ride.id}`);
            await sendBroadcast(broadcastMsg, ride.id);

            const rideUrl = `${process.env.MINI_APP_URL || 'https://poputki.online'}/ride/${ride.id}`;
            const personalMsg = `✅ <b>Ваша заявка опубликована!</b>\n\n${broadcastMsg}`;
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: 'Открыть поездку', web_app: { url: rideUrl } }]]
                }
            };
            await sendPersonalMessage(driver_id, personalMsg, options);
        } else {
            const deliveryText = allows_delivery ? '\n📦 Беру посылки' : '';
            const broadcastMsg = `🚗 ВОДИТЕЛЬ ИЩЕТ ПАССАЖИРОВ\n📍 Маршрут: ${from_city} ➡ ${to_city}\n🗓 Дата: ${dateStr}\n⏰ Время: ${timeStr}\n 💺 Свободных мест: ${seats}${deliveryText}`;
            console.log(`[Ride Creation] Broadcasting driver entry: ${ride.id}`);
            await sendBroadcast(broadcastMsg, ride.id);

            const rideUrl = `${process.env.MINI_APP_URL || 'https://poputki.online'}/ride/${ride.id}`;
            const personalMsg = `✅ <b>Ваш рейс опубликован!</b>\n\n${broadcastMsg}`;
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: 'Открыть поездку', web_app: { url: rideUrl } }]]
                }
            };
            await sendPersonalMessage(driver_id, personalMsg, options);
        }

    } catch (err) {
        console.error('Create ride error', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides/{id}/complete:
 *   post:
 *     summary: Complete a ride
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driver_id:
 *                 type: integer
 */
router.post('/:id/complete', async (req, res) => {
    const { id } = req.params;
    const { driver_id } = req.body;
    try {
        const { data: ride } = await supabase
            .from('rides')
            .select('driver_id, date, time')
            .eq('id', id)
            .single();

        if (!ride || ride.driver_id !== driver_id) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        const time = ride.time ? ride.time : '00:00:00';
        const rideDateTime = new Date(`${ride.date}T${time}`);

        if (new Date() < rideDateTime) {
            return res.status(400).json({ error: 'Нельзя завершить поездку до её начала' });
        }

        await supabase
            .from('rides')
            .update({ status: 'completed' })
            .eq('id', id);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides/{id}/cancel:
 *   post:
 *     summary: Cancel a ride (driver side)
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.post('/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const { driver_id } = req.body;
    try {
        const { data: ride } = await supabase
            .from('rides')
            .select('driver_id, date, time, status, from_city, to_city, is_passenger_entry')
            .eq('id', id)
            .single();

        if (!ride || ride.driver_id !== driver_id) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        if (ride.status === 'completed') {
            return res.status(400).json({ error: 'Cannot cancel a completed ride' });
        }

        const time = ride.time ? ride.time : '00:00:00';
        const rideDateTime = new Date(`${ride.date}T${time}`);

        if (new Date() >= rideDateTime) {
            return res.status(400).json({ error: 'Нельзя отменить поездку после её начала' });
        }

        await supabase
            .from('rides')
            .update({ status: 'cancelled' })
            .eq('id', id);

        // Fetch bookings before deleting to notify passengers
        const { data: bookings } = await supabase
            .from('bookings')
            .select('passenger_id')
            .eq('ride_id', id);

        // Also remove all bookings for this ride
        await supabase
            .from('bookings')
            .delete()
            .eq('ride_id', id);

        res.json({ success: true });

        // Telegram Notifications
        const dateStr = ride.date;
        const timeStr = ride.time ? ride.time.substring(0, 5) : '';

        if (!ride.is_passenger_entry && bookings && bookings.length > 0) {
            const cancelMsg = `🚫 <b>ПОЕЗДКА ОТМЕНЕНА</b>\n\nК сожалению, водитель отменил запланированную поездку:\n📍 <b>Маршрут:</b> ${ride.from_city} ➡ ${ride.to_city}\n🗓 <b>Дата и время:</b> ${dateStr} в ${timeStr}\n\n<i>Ваша бронь аннулирована. Пожалуйста, найдите другую поездку в приложении. Приносим извинения за неудобства.</i>`;
            bookings.forEach(b => {
                sendPersonalMessage(b.passenger_id, cancelMsg);
            });
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides/{id}:
 *   put:
 *     summary: Update a ride
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        const { data: ride, error } = await supabase
            .from('rides')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json(ride);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @swagger
 * /api/rides/{id}/share:
 *   post:
 *     summary: Share a driver's ride with a passenger
 *     tags: [Rides]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driver_ride_id:
 *                 type: integer
 */
router.post('/:id/share', async (req, res) => {
    const passengerReqId = req.params.id;
    const { driver_ride_id } = req.body;
    try {
        const { data: passengerReq, error: pError } = await supabase
            .from('rides')
            .select('*')
            .eq('id', passengerReqId)
            .single();

        if (pError || !passengerReq) {
            console.error('Share error (passengerReq):', pError);
            return res.status(404).json({ error: 'Заявка пассажира не найдена' });
        }

        if (!passengerReq.is_passenger_entry) {
            return res.status(400).json({ error: 'Эта поездка не является заявкой пассажира' });
        }

        const { data: driverRide, error: dError } = await supabase
            .from('rides')
            .select(`*, users:driver_id(name, phone)`)
            .eq('id', driver_ride_id)
            .single();

        if (dError || !driverRide) {
            console.error('Share error (driverRide):', dError);
            return res.status(404).json({ error: 'Поездка водителя не найдена' });
        }

        const dateStr = driverRide.date;
        const timeStr = driverRide.time ? driverRide.time.substring(0, 5) : '';
        const driverName = driverRide.users ? driverRide.users.name : 'Водитель';
        const driverPhone = driverRide.users ? driverRide.users.phone : '';

        // Add to telegram queue or send right away
        const msg = `🚗 <b>ВСТРЕЧНОЕ ПРЕДЛОЖЕНИЕ ПОЕЗДКИ</b>\n\nВодитель <b>${driverName}</b> предлагает вам присоединиться к его поездке:\n📍 <b>Маршрут:</b> ${driverRide.from_city} ➡ ${driverRide.to_city}\n🗓 <b>Дата и время:</b> ${dateStr} в ${timeStr}\n💵 <b>Цена от:</b> ${driverRide.price} с.\n\n<i>Откройте список поездок, найдите водителя и забронируйте место!</i>`;

        const rideUrl = `${process.env.MINI_APP_URL || 'https://poputki.online'}/ride/${driver_ride_id}`;
        const options = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Открыть поездку', web_app: { url: rideUrl } }]]
            }
        };

        const personalMsgSuccess = await sendPersonalMessage(passengerReq.driver_id, msg, options);

        if (!personalMsgSuccess) {
            return res.status(500).json({ error: 'Не удалось отправить уведомление пассажиру. Возможно, он не запустил бота.' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
