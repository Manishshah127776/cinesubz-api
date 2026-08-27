const express = require('express');
const router = express.Router();
const Scraper = require('../../scraper');

// Get all TV shows with pagination
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const cacheKey = `tvshows_page_${page}`;
        
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            data = await scraper.getAllTVShows(page);
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

// Get TV show details and download links
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `tvshow_details_${id}`;
        
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            
            const shows = await scraper.getAllTVShows(1);
            const show = shows.shows.find(s => 
                s.link && s.link.includes(id)
            );
            
            if (show && show.link) {
                const downloadInfo = await scraper.getDownloadLinks(show.link);
                data = { ...show, ...downloadInfo };
            } else {
                throw new Error('TV Show not found');
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