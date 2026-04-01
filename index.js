const express = require('express');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
    cloud_name: 'dlmnievol',
    api_key: '365173165178178',
    api_secret: 'RHw8S9slXFHNEzxvKKltYiCgfnE',
    secure: true,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Allow all origins
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.get("/health", (req, res) => {
    res.status(200).send("ok");
});

// Swagger Configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Poputki.online API',
            version: '1.0.0',
            description: 'API for the Poputki ride-sharing platform',
        },
        servers: [
            {
                url: `http://localhost:${PORT}`,
            },
        ],
    },
    apis: ['./routes/*.js'], // Scan all files in the routes directory
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Import Routes
const authRoutes = require('./routes/auth');
const busAdminRoutes = require('./routes/busAdmin');
const usersRoutes = require('./routes/users');
const bookingsRoutes = require('./routes/bookings');
const reviewsRoutes = require('./routes/reviews');
const busTicketsRoutes = require('./routes/busTickets');
const busBookingsRoutes = require('./routes/busBookings');
const adminRoutes = require('./routes/admin');
const generalRoutes = require('./routes/general');
const ridesRoutes = require('./routes/rides');
const smartpayRoutes = require('./routes/smartpay');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api', generalRoutes);
app.use('/api/general', generalRoutes);
app.use('/api/bus-admin', busAdminRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/bus-tickets', busTicketsRoutes);
app.use('/api/bus-ticket-bookings', busBookingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/payments', smartpayRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
