const express = require('express');
const router = express.Router();
const Scraper = require('../../scraper');

// Get all movies with pagination
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const cacheKey = `movies_page_${page}`;
        
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            data = await scraper.getAllMovies(page);
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

// Get movie details and download links
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `movie_details_${id}`;
        
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            
            // First get movie details from search or list
            const movies = await scraper.getAllMovies(1);
            const movie = movies.movies.find(m => 
                m.link && m.link.includes(id)
            );
            
            if (movie && movie.link) {
                const downloadInfo = await scraper.getDownloadLinks(movie.link);
                data = { ...movie, ...downloadInfo };
            } else {
                throw new Error('Movie not found');
            }
            
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