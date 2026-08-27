const express = require('express');
const router = express.Router();
const moviesRouter = require('./movie');
const tvshowsRouter = require('./tvshows');
const searchRouter = require('./search');
const downloadRouter = require('./download');

// API Documentation
router.get('/docs', (req, res) => {
    res.json({
        name: 'CineSubz API',
        version: '1.0.0',
        endpoints: {
            'GET /api/home': 'Get trending and top lists',
            'GET /api/movies': 'Get all movies (paginated)',
            'GET /api/movies/:id': 'Get movie details & download links',
            'GET /api/tvshows': 'Get all TV shows (paginated)',
            'GET /api/tvshows/:id': 'Get TV show details & download links',
            'GET /api/search?q=query&page=1': 'Search movies/TV shows',
            'GET /api/download?url=...': 'Get download links from a URL'
        }
    });
});

router.use('/movies', moviesRouter);
router.use('/tvshows', tvshowsRouter);
router.use('/search', searchRouter);
router.use('/download', downloadRouter);

// Home endpoint
router.get('/home', async (req, res) => {
    try {
        const cacheKey = 'homepage_data';
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new (require('../../scraper'))();
            await scraper.init();
            data = await scraper.scrapeHomepage();
            await scraper.close();
            
            req.cache.set(cacheKey, data);
        }
        
        res.json({
            success: true,
            data,
            cached: !!req.cache.get(cacheKey)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;