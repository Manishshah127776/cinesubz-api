const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');

const BASE_URL = 'https://cinesubz.lk';

class CineSubzScraper {
    constructor() {
        this.browser = null;
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        return this.browser;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    // Extract clean title, year, and type
    parseTitle(title) {
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : null;
        
        const isTVSeries = title.includes('TV Series') || title.includes('S0');
        const type = isTVSeries ? 'TV Series' : 'Movie';
        
        // Clean title (remove year, subtitle text)
        let cleanTitle = title
            .replace(/\(\d{4}\)/, '')
            .replace(/Sinhala Subtitles.*$/, '')
            .replace(/\|.*$/, '')
            .trim();
        
        return { cleanTitle, year, type };
    }

    // Scrape homepage for trending and top lists
    async scrapeHomepage() {
        const browser = await this.init();
        const page = await browser.newPage();
        
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const result = {
            trending: [],
            topMovies: [],
            topTVShows: []
        };

        // Extract trending items
        $('.trending-item, .item-trending, .featured-item').each((i, el) => {
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title) {
                const parsed = this.parseTitle(title);
                result.trending.push({
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        // Extract Top Movies
        $('.top-movies .item, .top-movies .post').each((i, el) => {
            const rank = i + 1;
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title) {
                const parsed = this.parseTitle(title);
                result.topMovies.push({
                    rank,
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        // Extract Top TV Shows
        $('.top-tvshows .item, .top-tvshows .post').each((i, el) => {
            const rank = i + 1;
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title) {
                const parsed = this.parseTitle(title);
                result.topTVShows.push({
                    rank,
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        await page.close();
        return result;
    }

    // Search for movies/TV shows
    async search(query, page = 1) {
        const browser = await this.init();
        const pageObj = await browser.newPage();
        
        // Navigate to search page (adjust URL based on actual search endpoint)
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}&page=${page}`;
        await pageObj.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        const html = await pageObj.content();
        const $ = cheerio.load(html);
        
        const results = [];
        
        $('.search-results .item, .search-results .post, .blog-item').each((i, el) => {
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title && title.toLowerCase().includes(query.toLowerCase())) {
                const parsed = this.parseTitle(title);
                results.push({
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        await pageObj.close();
        return {
            query,
            page,
            totalResults: results.length,
            results
        };
    }

    // Get download links for a specific movie/TV show
    async getDownloadLinks(url) {
        const browser = await this.init();
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const downloadLinks = [];
        
        // Look for download buttons/links (adjust selectors)
        $('a[href*="download"], a[href*="mega"], a[href*="gdrive"], .download-link, .btn-download').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            
            if (href && !href.includes('#')) {
                // Determine platform
                let platform = 'direct';
                if (href.includes('mega.nz')) platform = 'Mega';
                else if (href.includes('drive.google.com')) platform = 'Google Drive';
                else if (href.includes('mediafire.com')) platform = 'MediaFire';
                else if (href.includes('dropbox.com')) platform = 'Dropbox';
                
                downloadLinks.push({
                    platform,
                    label: text || platform,
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`
                });
            }
        });

        // Also look for subtitle download links
        const subtitleLinks = [];
        $('a[href*=".srt"], a[href*=".zip"], .subtitle-link').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            
            if (href) {
                subtitleLinks.push({
                    label: text || 'Subtitle',
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`
                });
            }
        });

        await page.close();
        return {
            downloadLinks,
            subtitleLinks
        };
    }

    // Get all movies (with pagination)
    async getAllMovies(page = 1) {
        const browser = await this.init();
        const pageObj = await browser.newPage();
        
        await pageObj.goto(`${BASE_URL}/movies/page/${page}`, { waitUntil: 'networkidle2' });
        
        const html = await pageObj.content();
        const $ = cheerio.load(html);
        
        const movies = [];
        
        $('.movie-item, .post, .item').each((i, el) => {
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title) {
                const parsed = this.parseTitle(title);
                movies.push({
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        await pageObj.close();
        return {
            page,
            total: movies.length,
            movies
        };
    }

    // Get all TV shows (with pagination)
    async getAllTVShows(page = 1) {
        const browser = await this.init();
        const pageObj = await browser.newPage();
        
        await pageObj.goto(`${BASE_URL}/tv-shows/page/${page}`, { waitUntil: 'networkidle2' });
        
        const html = await pageObj.content();
        const $ = cheerio.load(html);
        
        const shows = [];
        
        $('.tv-item, .post, .item').each((i, el) => {
            const title = $(el).find('h3, .title, a').text().trim();
            const rating = $(el).text().match(/★\s*([\d.]+)/)?.[1] || null;
            const link = $(el).find('a').attr('href') || null;
            
            if (title) {
                const parsed = this.parseTitle(title);
                shows.push({
                    ...parsed,
                    rating: rating ? parseFloat(rating) : null,
                    link: link ? `${BASE_URL}${link}` : null
                });
            }
        });

        await pageObj.close();
        return {
            page,
            total: shows.length,
            shows
        };
    }
}

module.exports = CineSubzScraper;