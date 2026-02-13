const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const axios = require('axios');
const path = require('path');

// --- Configuration ---
const HDHOMERUN_IP = process.env.HDHOMERUN_IP || '192.168.1.100';
const MEDIAFLOW_URL = process.env.MEDIAFLOW_URL || 'http://localhost:8888';
const MEDIAFLOW_PASS = process.env.MEDIAFLOW_PASS || '';
const EXTERNAL_URL = process.env.EXTERNAL_URL || 'http://stremioota.lan';
const PORT = process.env.PORT || 7000;
const DEBUG = process.env.DEBUG_LOGGING === 'true';

const MANIFEST = {
    id: 'org.titleos.hdhomerun',
    version: '1.0.0',
    name: 'HDHomerun Live',
    description: `OTA via ${HDHOMERUN_IP}`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [{ type: 'tv', id: 'hdhr_ota', name: 'HDHomerun' }],
    idPrefixes: ['hdhr_']
};

// Helper: Embed the name in the URL so the proxy knows what to look for
const getAssetUrl = (guideName) => {
    // Sanitize: "WCCO-DT" -> "WCCO" to improve matching chances
    const cleanName = guideName.replace(/[-\s]?(DT|HD|LD)\d*$/i, '').replace(/\s+/g, '');
    return `${EXTERNAL_URL}/assets/${encodeURIComponent(cleanName)}.png`;
};

const builder = new addonBuilder(MANIFEST);

// 1. Catalog Handler
builder.defineCatalogHandler(async ({ type, id }) => {
    if (DEBUG) console.log(`[CATALOG] Request for ${type} / ${id}`);
    try {
        const res = await axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 3000 });
        const metas = res.data.map(c => ({
            id: `hdhr_${c.GuideNumber}`,
            type: 'tv',
            name: c.GuideName,
            poster: getAssetUrl(c.GuideName),
            logo: getAssetUrl(c.GuideName),
            description: `Live on ${c.GuideName}`
        }));
        return { metas };
    } catch (e) {
        console.error(`[ERROR] Catalog fetch failed: ${e.message}`);
        return { metas: [] };
    }
});

// 2. Meta Handler
builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'tv' || !id.startsWith('hdhr_')) return { meta: null };
    const guideNum = id.replace('hdhr_', '');
    
    // We need to fetch the lineup again to get the name for the logo
    let guideName = `Channel ${guideNum}`;
    try {
        const res = await axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 1500 });
        const channel = res.data.find(c => c.GuideNumber === guideNum);
        if (channel) guideName = channel.GuideName;
    } catch (e) {}

    return {
        meta: {
            id: id,
            type: 'tv',
            name: guideName,
            poster: getAssetUrl(guideName),
            logo: getAssetUrl(guideName),
            background: getAssetUrl(guideName),
            description: `Live OTA Broadcast from HDHomerun Tuner.`,
            runtime: "LIVE",
            behaviorHints: { isLive: true }
        }
    };
});

// 3. Stream Handler
builder.defineStreamHandler(async ({ type, id }) => {
    if (DEBUG) console.log(`[STREAM] Request for ${type} / ${id}`);
    if (type !== 'tv' || !id.startsWith('hdhr_')) return { streams: [] };

    const guideNum = id.replace('hdhr_', '');
    const rawUrl = `http://${HDHOMERUN_IP}:5004/auto/v${guideNum}`;
    const proxiedUrl = `${MEDIAFLOW_URL}/proxy/stream?d=${encodeURIComponent(rawUrl)}&api_password=${encodeURIComponent(MEDIAFLOW_PASS)}`;
    
    let techInfoStream = null;
    try {
        const [discoverRes, lineupRes] = await Promise.all([
            axios.get(`http://${HDHOMERUN_IP}/discover.json`, { timeout: 1500 }),
            axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 1500 })
        ]);
        const tuner = discoverRes.data;
        const channel = lineupRes.data.find(c => c.GuideNumber === guideNum);

        if (channel) {
            const tunerStr = `${tuner.FriendlyName || 'HDHomeRun'} (${tuner.ModelNumber || 'UNK'}) FW:${tuner.FirmwareVersion || '?'}`;
            const signalStr = `Signal: ${channel.SignalStrength}% / Qual: ${channel.SignalQuality}%`;
            const codecStr = `${channel.VideoCodec || 'UNK'}/${channel.AudioCodec || 'UNK'}`;
            const hdStr = channel.HD === 1 ? 'HD' : 'SD';

            techInfoStream = {
                name: "ℹ️ DEVICE INFO",
                title: `${tunerStr}\n${signalStr}\n${codecStr} (${hdStr})`,
                url: `${EXTERNAL_URL}/assets/fallback_icon.png`
            };
        }
    } catch (e) {
        techInfoStream = {
            name: "ℹ️ DEVICE INFO",
            title: "Unavailable - Could not reach HDHomeRun API",
            url: `${EXTERNAL_URL}/assets/fallback_icon.png`
        };
    }

    const streams = [
        { title: '🌀 Mediaflow Proxy', url: proxiedUrl, behaviorHints: { notWebReady: false } },
        { title: '📡 Direct HDHomerun', url: rawUrl, behaviorHints: { notWebReady: true } }
    ];
    if (techInfoStream) streams.push(techInfoStream);

    return { streams };
});

// --- Server Setup ---
const app = express();
const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);

if (DEBUG) app.use((req, res, next) => { console.log(`[HTTP] ${req.method} ${req.url}`); next(); });
app.use('/', addonRouter);

// --- ASSET ROUTE: The Logic Engine ---
app.get('/assets/:filename', async (req, res) => {
    const rawName = req.params.filename.replace('.png', '');
    const cleanName = decodeURIComponent(rawName);

    // 1. Define Sources
    const githubUrl = `https://raw.githubusercontent.com/tv-logos/tv-logos/main/countries/united-states/${cleanName}.png`;
    const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${cleanName}&background=random&color=fff&size=512&font-size=0.5&bold=true`;

    if (DEBUG) console.log(`[ASSET] Looking for logo: ${cleanName}`);

    try {
        // A. Try GitHub Repo first (Real Logo)
        // We use a HEAD request to check if it exists without downloading the whole thing
        await axios.head(githubUrl, { timeout: 1500 });
        if (DEBUG) console.log(`[ASSET] Found on GitHub: ${cleanName}`);
        res.redirect(githubUrl);
    } catch (e1) {
        try {
            // B. GitHub failed? Fallback to UI Avatars (Generated Initials)
            // This guarantees a dynamic, unique image for every channel
            if (DEBUG) console.log(`[ASSET] GitHub missed. Using UI Avatar for: ${cleanName}`);
            res.redirect(uiAvatarsUrl);
        } catch (e2) {
            // C. Final Fallback (Your local icon)
            if (DEBUG) console.log(`[ASSET] Total failure. Serving fallback_icon.png`);
            res.sendFile(path.join(__dirname, 'fallback_icon.png'));
        }
    }
});

app.get('/health', async (req, res) => {
    try {
        await axios.get(`http://${HDHOMERUN_IP}/discover.json`, { timeout: 1500 });
        res.status(200).send('OK');
    } catch (e) { res.status(503).send('Unreachable'); }
});

app.listen(PORT, () => console.log(`Addon active on port ${PORT} (Debug: ${DEBUG})`));
