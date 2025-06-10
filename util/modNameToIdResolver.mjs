import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('./.env') });

const API_KEY = process.env.CURSEFORGE_TOKEN;
const OUTPUT_PATH = path.resolve('./sourcedata/modIds.json');
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

try {
    const mods = await fetchAllMods();
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(mods, null, 2), 'utf-8');
    console.log(`Fetched ${mods.length} mods and saved to ${OUTPUT_PATH}`);
} catch (err) {
    console.error('Error fetching mods:', err);
}
