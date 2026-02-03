import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config.js';

export const startServer = async () => {
    const server = http.createServer(async (req, res) => {
        if (req.url === `/feed.xml`) {
            try {
                const rssFeed = await fs.readFile(config.rssPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
                res.end(rssFeed);
            } catch {
                res.writeHead(404);
                res.end('Feed not found. Please wait for the first fetch.');
            }
        } else if (req.url === `/${config.faviconPath}`) {
            try {
                // We need to look for the favicon relative to the project root, not the dist folder
                // Assuming the server is running from the project root or dist/src
                const faviconPath = path.resolve(process.cwd(), config.faviconPath);
                const favicon = await fs.readFile(faviconPath);
                res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
                res.end(favicon);
            } catch (e) {
                console.error(e);
                res.writeHead(404);
                res.end('Favicon not found.');
            }
        } else if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(config.port, () => {
        console.log(`Server started at http://localhost:${config.port}/feed.xml`);
    });
};
