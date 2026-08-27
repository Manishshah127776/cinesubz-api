const express = require('express');
const router = express.Router();
const Scraper = require('../../scraper');

router.get('/', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL parameter is required'
            });
        }
        
        const cacheKey = `download_${Buffer.from(url).toString('base64')}`;
        let data = req.cache.get(cacheKey);
        
        if (!data) {
            const scraper = new Scraper();
            await scraper.init();
            data = await scraper.getDownloadLinks(url);
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