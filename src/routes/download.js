const express = require('express');
const router = express.Router();
const Scraper = require('../../scraper');

function parsePageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('URL parameter is required');
    }

    let parsed;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new Error('URL must be a complete valid URL, for example https://example.com/movie-page');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error('URL must use http:// or https:// and include a hostname');
    }

    return parsed.href;
}

router.get('/', async (req, res) => {
    let scraper;

    try {
        const pageUrl = parsePageUrl(req.query.url);
        const cacheKey = `download_${Buffer.from(pageUrl).toString('base64')}`;
        let data = req.cache.get(cacheKey);

        if (!data) {
            scraper = new Scraper();
            await scraper.init();
            data = await scraper.getDownloadLinks(pageUrl);
            req.cache.set(cacheKey, data);
        }

        res.json({
            success: true,
            data,
            cached: !!req.cache.get(cacheKey)
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isInputError = message === 'URL parameter is required' ||
            message.startsWith('URL must be');
        res.status(isInputError ? 400 : 502).json({
            success: false,
            error: message
        });
    } finally {
        if (scraper) {
            await scraper.close().catch(() => {});
        }
    }
});

module.exports = router;
