const express = require('express');
const router = express.Router();
const Scraper = require('../../scraper');

router.get('/', async (req, res) => {
    try {
        const { q, page = 1 } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Search query must be at least 2 characters'
            });
        }
        
        const cacheKey = `search_${q}_${page}`;
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            data = await scraper.search(q, parseInt(page));
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