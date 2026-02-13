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
    version: '1.4.0',
    name: 'HDHomerun Live',
    description: `OTA via ${HDHOMERUN_IP}`,
    resources: ['catalog', 'meta', 'stream'],
    // CHANGE: 'channel' type fixes the "No Information" error for live streams
    types: ['channel'], 
    catalogs: [{ type: 'channel', id: 'hdhr_ota', name: 'HDHomerun' }],
    idPrefixes: ['hdhr_']
};

// Helper: Embed the name in the URL so the proxy knows what to look for
const getAssetUrl = (guideName) => {
    const cleanName = guideName.replace(/[-\s]?(DT|HD|LD)\d*$/i, '').replace(/\s+/g, '');
    return `${EXTERNAL_URL}/assets/${encodeURIComponent(cleanName)}.png`;
};

// Helper: Fetch Guide Data from SiliconDust Cloud API
const getNowPlaying = async (guideNumber) => {
    try {
        // 1. Get Device Auth String from local tuner
        const discover = await axios.get(`http://${HDHOMERUN_IP}/discover.json`, { timeout: 1000 });
        const deviceAuth = discover.data.DeviceAuth;
        if (!deviceAuth) return null;

        // 2. Query the SiliconDust Cloud API (Native HDHR EPG)
        // This is better than a generic database because it matches your exact tuner config
        const guideRes = await axios.get(`http://api.hdhomerun.com/api/guide?DeviceAuth=${deviceAuth}`, { timeout: 2000 });
        
        // 3. Find our channel
        const channelData = guideRes.data.find(c => c.GuideNumber === guideNumber);
        if (!channelData || !channelData.Guide) return null;

        // 4. Find the current program
        const now = Math.floor(Date.now() / 1000);
        const currentProg = channelData.Guide.find(p => now >= p.StartTime && now < p.EndTime);
        
        return currentProg ? currentProg.Title : null;
    } catch (e) {
        if (DEBUG) console.log(`[EPG] Failed to fetch guide: ${e.message}`);
        return null;
    }
};

const builder = new addonBuilder(MANIFEST);

// 1. Catalog Handler
builder.defineCatalogHandler(async ({ type, id }) => {
    if (DEBUG) console.log(`[CATALOG] Request for ${type} / ${id}`);
    try {
        const res = await axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 3000 });
        // Map 'channel' type
        const metas = res.data.map(c => ({
            id: `hdhr_${c.GuideNumber}`,
            type: 'channel',
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
    if (type !== 'channel' || !id.startsWith('hdhr_')) return { meta: null };
    const guideNum = id.replace('hdhr_', '');
    
    // Fetch Basic Info
    let guideName = `Channel ${guideNum}`;
    try {
        const res = await axios.get(`http://${HDHOMERUN_IP}/lineup.json`, { timeout: 1500 });
        const channel = res.data.find(c => c.GuideNumber === guideNum);
        if (channel) guideName = channel.GuideName;
    } catch (e) {}

    // Fetch EPG (Now Playing)
    const currentProgram = await getNowPlaying(guideNum);
    const description = currentProgram 
        ? `Live on ${currentProgram}` 
        : `Live on ${guideName}`;

    return {
        meta: {
            id: id,
            type: 'channel',
            name: guideName,
            poster: getAssetUrl(guideName),
            logo: getAssetUrl(guideName),
            background: getAssetUrl(guideName),
            description: description,
            runtime: "LIVE",
            behaviorHints: { 
                isLive: true,
                defaultVideoId: id // Helps Stremio know to play immediately
            }
        }
    };
});

// 3. Stream Handler
builder.defineStreamHandler(async ({ type, id }) => {
    if (DEBUG) console.log(`[STREAM] Request for ${type} / ${id}`);
    if (type !== 'channel' || !id.startsWith('hdhr_')) return { streams: [] };

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

// --- ASSET ROUTE ---
app.get('/assets/:filename', async (req, res) => {
    const rawName = req.params.filename.replace('.png', '');
    const cleanName = decodeURIComponent(rawName);

    const githubUrl = `https://raw.githubusercontent.com/tv-logos/tv-logos/main/countries/united-states/${cleanName}.png`;
    const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${cleanName}&background=random&color=fff&size=512&font-size=0.5&bold=true`;

    if (DEBUG) console.log(`[ASSET] Looking for logo: ${cleanName}`);

    try {
        await axios.head(githubUrl, { timeout: 1500 });
        if (DEBUG) console.log(`[ASSET] Found on GitHub: ${cleanName}`);
        res.redirect(githubUrl);
    } catch (e1) {
        try {
            if (DEBUG) console.log(`[ASSET] GitHub missed. Using UI Avatar for: ${cleanName}`);
            res.redirect(uiAvatarsUrl);
        } catch (e2) {
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
