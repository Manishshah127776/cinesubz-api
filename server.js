require('dotenv').config();
const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const routes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache setup (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make cache available in routes
app.use((req, res, next) => {
    req.cache = cache;
    next();
});

// Routes
app.use('/api', routes);

// API landing page
app.get('/', (req, res) => {
    res.json({
        name: 'CineSubz API',
        status: 'running',
        docs: '/api/docs',
        health: '/health'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 CineSubz API running on http://localhost:${PORT}`);
    console.log(`📖 API Docs: http://localhost:${PORT}/api/docs`);
});