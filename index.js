const express = require('express');
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

// Manual origin check middleware (No CORS library)
app.use((req, res, next) => {
    const origin = req.get('Origin');
    const referer = req.get('Referer') || '';
    
    // Explicitly allow both production and common development origins
    const allowedOrigins = [
        'https://poputki.online', 
        'https://www.poputki.online',
        'http://poputki.online',
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000'
    ];
    
    // Check if the current request origin is allowed
    const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.some(a => referer.startsWith(a));
    
    // CORS headers - ALWAYS send for allowed origins to prevent browser errors
    if (isAllowed && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle Preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    // Exception for health check
    if (req.path === '/health') return next();

    // Reject all other unauthorized traffic
    if (!isAllowed) {
        console.warn(`[SECURITY] Blocked request from: ${origin || referer || 'Unknown'}`);
        return res.status(403).json({ error: 'Access forbidden: unauthorized origin' });
    }

    next();
});
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
