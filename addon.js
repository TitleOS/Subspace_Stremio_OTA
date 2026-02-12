const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const axios = require('axios');
const path = require('path');

// --- Configuration ---
const HDHOMERUN_IP = process.env.HDHOMERUN_IP || '192.168.1.100';
const MEDIAFLOW_URL = process.env.MEDIAFLOW_URL || 'http://localhost:8888';
const MEDIAFLOW_PASS = process.env.MEDIAFLOW_PASS || '';
const PORT = process.env.PORT || 7000;
const EXTERNAL_URL = process.env.EXTERNAL_URL || `http://stremioota.lan`;

const MANIFEST = {
    id: 'org.titleos.hdhomerun',
    version: '1.2.2',
    name: 'HDHomerun Live',
    description: `OTA via ${HDHOMERUN_IP}`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [{ type: 'tv', id: 'hdhr_ota', name: 'HDHomerun' }],
    idPrefixes: ['hdhr_']
};

// Helper: Determine if a logo likely exists or return the placeholder
const getAssetUrl = (guideNum) => {
    // If you want to blindly trust the tuner:
    // return `http://${HDHOMERUN_IP}/images/L${guideNum}.png`;
    
    // Better: Serve the fallback from our own server
    return `${EXTERNAL_URL}/assets/L${guideNum}.png`;
};

const builder = new addonBuilder(MANIFEST);

// 1. Catalog Handler
builder.defineCatalogHandler(async () => {
    try {
        const res = await axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 3000 });
        const metas = res.data.map(c => ({
            id: `hdhr_${c.GuideNumber}`,
            type: 'tv',
            name: c.GuideName,
            poster: getAssetUrl(c.GuideNumber),
            logo: getAssetUrl(c.GuideNumber),
            description: `Live on ${c.GuideName}`
        }));
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// 2. Meta Handler
builder.defineMetaHandler(async ({ id }) => {
    const guideNum = id.replace('hdhr_', '');
    return {
        meta: {
            id,
            type: 'tv',
            name: `Channel ${guideNum}`,
            poster: getAssetUrl(guideNum),
            logo: getAssetUrl(guideNum),
            background: getAssetUrl(guideNum),
            description: `Streaming Live from HDHomerun Channel ${guideNum}`,
        }
    };
});

// 3. Stream Handler
builder.defineStreamHandler(async ({ id }) => {
    const guideNum = id.replace('hdhr_', '');
    const rawUrl = `http://${HDHOMERUN_IP}:5004/auto/v${guideNum}`;
    const proxiedUrl = `${MEDIAFLOW_URL}/proxy/stream?d=${encodeURIComponent(rawUrl)}&api_password=${MEDIAFLOW_PASS}`;
    return {
        streams: [
            { title: '🌀 Mediaflow Proxy', url: proxiedUrl },
            { title: '📡 Direct HDHomerun', url: rawUrl }
        ]
    };
});

// --- Server Setup ---
const app = express();
const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);

app.use('/', addonRouter);

// New Asset Route: Tries to get the real logo, falls back to your retro TV PNG
app.get('/assets/:filename', async (req, res) => {
    const logoUrl = `http://${HDHOMERUN_IP}/images/${req.params.filename}`;
    try {
        // We do a quick HEAD request to see if the tuner actually has the logo
        await axios.head(logoUrl, { timeout: 1000 });
        res.redirect(logoUrl);
    } catch (e) {
        // Fallback to the local file in your repo
        res.sendFile(path.join(__dirname, 'fallback_icon.png'));
    }
});

app.get('/health', async (req, res) => {
    try {
        await axios.get(`http://${HDHOMERUN_IP}/discover.json`, { timeout: 1500 });
        res.status(200).send('OK');
    } catch (e) { res.status(503).send('Unreachable'); }
});

app.listen(PORT, () => console.log(`Addon active on port ${PORT}`));
