const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { sendPersonalMessage } = require('../utils/telegramBot');

const SMARTPAY_API_KEY = '2334b91a76a8555daf6c2c2090f42cffea999a33927061593a9794e0c404bd31';
const SMARTPAY_BASE_URL = 'https://sandbox.smartpay.tj/api/merchant';
const FRONTEND_URL = 'https://poputki.online';

/**
 * POST /api/payments/create-invoice
 * Creates a booking with pending_payment status and a SmartPay invoice
 */
router.post('/create-invoice', async (req, res) => {
    const { bus_ticket_id, passenger_id, seat_numbers, passengers_data, phone, pickup_city, drop_off_city } = req.body;

    // Verify user
    const { data: userExists, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('id', passenger_id)
        .maybeSingle();

    if (userError || !userExists) {
        return res.status(401).json({ error: 'Пользователь не найден' });
    }
    if (!seat_numbers || !seat_numbers.length) {
        return res.status(400).json({ error: 'Seat numbers required' });
    }
    if (!passengers_data || !passengers_data.length) {
        return res.status(400).json({ error: 'Passenger data required' });
    }

    try {
        // Fetch ticket
        const { data: ticket, error: ticketError } = await supabase
            .from('bus_tickets')
            .select('*')
            .eq('id', bus_ticket_id)
            .single();

        if (ticketError || !ticket) return res.status(404).json({ error: 'Ticket not found' });

        // Check seat availability
        const { data: existingBookings } = await supabase
            .from('bus_ticket_bookings')
            .select('seat_numbers')
            .eq('bus_ticket_id', bus_ticket_id)
            .in('status', ['confirmed', 'pending_payment']);

        const takenSeats = [];
        (existingBookings || []).forEach(b => {
            const seats = typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []);
            takenSeats.push(...seats);
        });

        const conflict = seat_numbers.some(s => takenSeats.includes(s));
        if (conflict) return res.status(400).json({ error: 'Одно или несколько мест уже заняты' });

        // Calculate price
        const premiumSeatNums = ticket.bus_type === 'double' ? [1, 2, 3, 4, 69, 70, 71, 72, 73, 74, 75, 76] : [];
        const premiumPrice = ticket.premium_price || ticket.price;
        let totalPrice = 0;
        for (const seatNum of seat_numbers) {
            totalPrice += premiumSeatNums.includes(seatNum) ? premiumPrice : ticket.price;
        }

        // Generate unique order_id
        const paymentOrderId = `bus_${bus_ticket_id}_${passenger_id}_${Date.now()}`;

        // Create booking with pending_payment status
        const { data: booking, error: insertError } = await supabase
            .from('bus_ticket_bookings')
            .insert([{
                bus_ticket_id,
                passenger_id,
                seat_numbers,
                passenger_count: seat_numbers.length,
                passengers_data,
                phone,
                status: 'pending_payment',
                total_price: totalPrice,
                pickup_city,
                drop_off_city,
                payment_order_id: paymentOrderId
            }])
            .select('id')
            .single();

        if (insertError) throw insertError;

        // Reserve seats immediately to prevent double-booking
        const allTakenSeats = [...takenSeats, ...seat_numbers];
        await supabase
            .from('bus_tickets')
            .update({ reserved_seats: allTakenSeats })
            .eq('id', bus_ticket_id);

        // Create SmartPay invoice
        const returnUrl = `${FRONTEND_URL}/payment-result?order_id=${paymentOrderId}`;
        const description = `Билет ${ticket.from_city} → ${ticket.to_city}, ${seat_numbers.length} мест (${seat_numbers.join(', ')})`;

        const invoiceResponse = await fetch(`${SMARTPAY_BASE_URL}/invoices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-app-token': SMARTPAY_API_KEY
            },
            body: JSON.stringify({
                amount: totalPrice,
                description,
                order_id: paymentOrderId,
                return_url: returnUrl,
                lifetime: 1800,
                customer_phone: phone ? phone.replace(/^\+992/, '').replace(/\D/g, '') : undefined
            })
        });

        const invoiceData = await invoiceResponse.json();

        if (!invoiceResponse.ok || !invoiceData.payment_link) {
            // Rollback: delete the booking and unreserve seats
            await supabase.from('bus_ticket_bookings').delete().eq('id', booking.id);
            const restoredSeats = takenSeats; // revert to before our seats
            await supabase.from('bus_tickets').update({ reserved_seats: restoredSeats }).eq('id', bus_ticket_id);
            return res.status(502).json({ error: 'Ошибка создания платежа. Попробуйте позже.' });
        }

        // Store invoice data
        await supabase
            .from('bus_ticket_bookings')
            .update({
                invoice_uuid: invoiceData.invoice_uuid,
                payment_link: invoiceData.payment_link
            })
            .eq('id', booking.id);

        res.json({
            booking_id: booking.id,
            payment_link: invoiceData.payment_link,
            order_id: paymentOrderId
        });

    } catch (err) {
        console.error('Payment create-invoice error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/payments/verify/:order_id
 * Checks payment status with SmartPay and updates booking accordingly
 */
router.get('/verify/:order_id', async (req, res) => {
    const { order_id } = req.params;

    try {
        // Find our booking
        const { data: booking, error: bookingError } = await supabase
            .from('bus_ticket_bookings')
            .select('*, bus_tickets(*)')
            .eq('payment_order_id', order_id)
            .single();

        if (bookingError || !booking) {
            return res.status(404).json({ error: 'Бронь не найдена' });
        }

        // If already confirmed, just return success
        if (booking.status === 'confirmed') {
            return res.json({ status: 'confirmed', booking_id: booking.id });
        }

        // Poll SmartPay for status
        const statusResponse = await fetch(`${SMARTPAY_BASE_URL}/order/status/${order_id}`, {
            headers: { 'x-app-token': SMARTPAY_API_KEY }
        });

        const statusData = await statusResponse.json();
        const paymentStatus = statusData.status;

        if (paymentStatus === 'Charged') {
            // Payment successful — confirm booking
            await supabase
                .from('bus_ticket_bookings')
                .update({ status: 'confirmed' })
                .eq('id', booking.id);

            res.json({ status: 'confirmed', booking_id: booking.id });

            // Send Telegram notifications (fire-and-forget)
            const ticket = booking.bus_tickets;
            if (ticket) {
                const dateStr = ticket.departure_date;
                const timeStr = ticket.departure_time ? ticket.departure_time.substring(0, 5) : '';
                const seatNums = booking.seat_numbers || [];

                let passengersList = '';
                const pData = booking.passengers_data || [];
                pData.forEach((p, idx) => {
                    const genderStr = p.gender === 'male' ? 'Муж.' : (p.gender === 'female' ? 'Жен.' : '');
                    passengersList += `\n${idx + 1}. ${p.lastName || ''} ${p.firstName || ''} (${genderStr}) - Место: ${seatNums[idx] || '—'} [${p.docType || 'Док'}: ${p.docNumber || '—'}]`;
                });

                const ticketMsg = `🎫 <b>ЭЛЕКТРОННЫЙ БИЛЕТ НА АВТОБУС</b> 🎫\n\n` +
                    `✅ <b>Статус:</b> Оплачено\n` +
                    `🚌 <b>Рейс:</b> ${ticket.from_city} ➡ ${ticket.to_city}\n` +
                    `📍 <b>Маршрут:</b> ${booking.pickup_city || ticket.from_city} ➡ ${booking.drop_off_city || ticket.to_city}\n` +
                    `🗓 <b>Дата и время:</b> ${dateStr} в ${timeStr}\n\n` +
                    `📞 <b>Покупатель:</b> ${booking.phone}\n` +
                    `💺 <b>Количество мест:</b> ${seatNums.length} (Места: ${seatNums.join(', ')})\n` +
                    `👥 <b>Пассажиры:</b>${passengersList}\n\n` +
                    `💰 <b>Общая стоимость:</b> ${booking.total_price} сом\n\n` +
                    `<i>Пожалуйста, сохраните этот билет. Счастливого пути!</i>\n\n` +
                    `Poputki.online — это информационный сервис (агрегатор), а не перевозчик`;

                sendPersonalMessage(booking.passenger_id, ticketMsg);

                if (ticket.operator_id) {
                    const driverMsg = `🔔 <b>НОВОЕ БРОНИРОВАНИЕ (ОПЛАЧЕНО)</b> 🚌\n\n` +
                        `📍 <b>Рейс:</b> ${ticket.from_city} ➡ ${ticket.to_city}\n` +
                        `маршрут: <b>${booking.pickup_city || ticket.from_city} ➡ ${booking.drop_off_city || ticket.to_city}</b>\n` +
                        `🗓 <b>Дата/время:</b> ${dateStr} в ${timeStr}\n\n` +
                        `👤 <b>Основной контакт:</b> ${booking.phone}\n` +
                        `💺 <b>Места:</b> ${seatNums.join(', ')} (${seatNums.length} чел.)\n` +
                        `👥 <b>Список пассажиров:</b>${passengersList}\n\n` +
                        `💰 <b>Сумма:</b> ${booking.total_price} сом`;

                    sendPersonalMessage(ticket.operator_id, driverMsg);
                }
            }

        } else if (paymentStatus === 'Expired' || paymentStatus === 'Rejected') {
            // Payment failed — cancel booking and release seats
            await supabase
                .from('bus_ticket_bookings')
                .update({ status: 'cancelled' })
                .eq('id', booking.id);

            // Release reserved seats
            const ticket = booking.bus_tickets;
            if (ticket) {
                const { data: otherBookings } = await supabase
                    .from('bus_ticket_bookings')
                    .select('seat_numbers')
                    .eq('bus_ticket_id', ticket.id)
                    .in('status', ['confirmed', 'pending_payment'])
                    .neq('id', booking.id);

                const stillTaken = [];
                (otherBookings || []).forEach(b => {
                    const seats = typeof b.seat_numbers === 'string' ? JSON.parse(b.seat_numbers || '[]') : (b.seat_numbers || []);
                    stillTaken.push(...seats);
                });

                await supabase
                    .from('bus_tickets')
                    .update({ reserved_seats: stillTaken })
                    .eq('id', ticket.id);
            }

            res.json({ status: 'failed', reason: paymentStatus });

        } else {
            // Still pending (Created or other)
            res.json({ status: 'pending', payment_link: booking.payment_link });
        }

    } catch (err) {
        console.error('Payment verify error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
