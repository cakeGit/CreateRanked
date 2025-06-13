import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('./.env') });

const API_KEY = process.env.CURSEFORGE_TOKEN;
const API_URL = 'https://api.curseforge.com/v1/mods/search';

const PAGE_SIZE = 50;
const GAME_ID = 432;
const SEARCH_FILTER = 'create';

async function fetchAllMods() {
    let allMods = [];
    let index = 0;
    let totalCount = 0;
    let fetched = 0;

    do {
        console.log(`Fetching mods from index ${index}...`);
        const url = `${API_URL}?gameId=${GAME_ID}&searchFilter=${SEARCH_FILTER}&index=${index}&pageSize=${PAGE_SIZE}`;
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'x-api-key': API_KEY
            }
        });

        if (!res.ok) {
            throw new Error(`Failed to fetch mods: ${res.statusText}`);
        }

        const data = await res.json();
        if (index === 0) {
            totalCount = data.pagination?.totalCount || 0;
        }
        allMods.push(...data.data);
        fetched += data.data.length;
        index += PAGE_SIZE;
    } while (fetched < totalCount);

    return allMods;
}

var mods;
try {
    mods = await fetchAllMods();
    console.log(`Fetched ${mods.length} mods from CurseForge API, going to processor`);
} catch (err) {
    console.error('Error fetching mods:', err);
    throw err;
}

const MODS_OUTPUT_PATH = path.resolve('./data/mods.json');
const AUTHORS_OUTPUT_PATH = path.resolve('./data/authors.json');

function daysSince(dateString) {
    const created = new Date(dateString);
    const now = new Date();
    const diff = (now - created) / (1000 * 60 * 60 * 24);
    return diff > 0 ? diff : 1; // Avoid division by zero
}

async function processMods() {
    const filtered = mods.filter(mod => {
        if (mod.links?.websiteUrl?.includes('/modpacks/') || mod.links?.websiteUrl?.includes("/bukkit-plugins/")) return false;

        const hasCreateCategory = Array.isArray(mod.categories) && mod.categories.some(cat => cat.id === 6484);

        const nameStartsWithCreate = typeof mod.name === 'string' && (/^create(?:)\s/.test(mod.name.trim().toLowerCase()));

        return hasCreateCategory || nameStartsWithCreate;
    });

    // Map mods with download stats
    const mappedMods = filtered.map(mod => {
        const author = Array.isArray(mod.authors) && mod.authors.length > 0 ? mod.authors[0].name : null;
        const authors = Array.isArray(mod.authors) ? mod.authors.map(a => a.name) : null;
        const downloadCount = typeof mod.downloadCount === 'number' ? mod.downloadCount : 0;
        const createdAt = mod.dateCreated || mod.dateReleased || mod.dateModified;
        const days = createdAt ? daysSince(createdAt) : 1;
        const downloadRate = downloadCount / days;

        return {
            id: mod.id,
            name: mod.name,
            author,
            authors,
            downloadCount,
            downloadRate: Number(downloadRate.toFixed(2)),
            createdAt,
            daysExisting: Number(days.toFixed(2))
        };
    });

    const authorStats = {};
    mappedMods.forEach(mod => {
        for (const author of mod.authors || []) {
            if (!authorStats[author]) {
                authorStats[author] = {
                    name: author,
                    downloadCount: 0,
                    mods: 0,
                    createdAtList: [],
                };
            }
            authorStats[author].downloadCount += mod.downloadCount;
            authorStats[author].mods += 1;
            if (mod.createdAt) authorStats[author].createdAtList.push(mod.createdAt);
        }
    });

    // Calculate author download rates (total downloads / avg days since created for their mods)
    const authors = Object.values(authorStats).map(author => {
        const avgDays = author.createdAtList.length
            ? author.createdAtList.map(daysSince).reduce((a, b) => a + b, 0) / author.createdAtList.length
            : 1;
        return {
            name: author.name,
            downloadCount: author.downloadCount,
            mods: author.mods,
            downloadRate: Number((author.downloadCount / avgDays).toFixed(2)),
            daysExisting: Number(avgDays.toFixed(2))
        };
    });

    const result = {
        generatedAt: new Date().toISOString(),
        mods: mappedMods
    };

    await fs.writeFile(MODS_OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
    await fs.writeFile(AUTHORS_OUTPUT_PATH, JSON.stringify({ generatedAt: result.generatedAt, authors }, null, 2), 'utf-8');
    console.log(`Processed ${result.mods.length} mods and saved to ${MODS_OUTPUT_PATH}`);
    console.log(`Saved ${authors.length} unique authors to ${AUTHORS_OUTPUT_PATH}`);
}

processMods().catch(err => {
    console.error('Error processing mods:', err);
});

