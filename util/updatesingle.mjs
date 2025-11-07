import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';

dotenv.config({ path: path.resolve('./.env') });

const API_KEY = process.env.CURSEFORGE_TOKEN;
const API_URL = 'https://api.curseforge.com/v1/mods/search';

const PAGE_SIZE = 50;
const GAME_ID = 432;
const SEARCH_FILTER = 'create';
const MAX_MODS = parseInt(process.env.MAX_MODS, 10) || 10000;

var authorFileData = {};

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
    } while (fetched < totalCount && index < MAX_MODS);

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
const DATA_DIR = path.resolve('./data');
const ARCHIVE_DIR = path.resolve('./data/archive');
const LOG_FILE = path.resolve('./data/dataCollectionLog.txt');

function daysSince(dateString) {
    const created = new Date(dateString);
    const now = new Date();
    const diff = (now - created) / (1000 * 60 * 60 * 24);
    return diff > 0 ? diff : 1; // Avoid division by zero
}

async function archivePreviousData() {
    // Create archive directory if it doesn't exist
    try {
        await fs.access(ARCHIVE_DIR);
    } catch {
        await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    }

    // Archive mods.json if it exists
    let archivedAny = false;
    let dateStr = null;
    try {
        await fs.access(MODS_OUTPUT_PATH);
        const modsData = await fs.readFile(MODS_OUTPUT_PATH, 'utf-8');
        const mods = JSON.parse(modsData);
        const timestamp = mods.generatedAt ? new Date(mods.generatedAt) : new Date();
        dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD format
        await fs.writeFile(path.join(ARCHIVE_DIR, `mods-${dateStr}.json`), modsData, 'utf-8');
        console.log(`Archived previous mods data as mods-${dateStr}.json`);
        archivedAny = true;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.log('Error archiving mods.json:', err.message);
        } else {
            console.log('No previous mods.json to archive.');
        }
    }

    // Archive authors.json if it exists
    try {
        await fs.access(AUTHORS_OUTPUT_PATH);
        const authorsData = await fs.readFile(AUTHORS_OUTPUT_PATH, 'utf-8');
        // Use dateStr from mods.json if available, otherwise use current date
        let authorsDateStr = dateStr;
        if (!authorsDateStr) {
            authorsDateStr = new Date().toISOString().split('T')[0];
        }
        await fs.writeFile(path.join(ARCHIVE_DIR, `authors-${authorsDateStr}.json`), authorsData, 'utf-8');
        console.log(`Archived previous authors data as authors-${authorsDateStr}.json`);
        archivedAny = true;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.log('Error archiving authors.json:', err.message);
        } else {
            console.log('No previous authors.json to archive.');
        }
    }

    if (!archivedAny) {
        console.log('No previous data to archive.');
    }
}

async function getArchivedDates() {
    try {
        const files = await fs.readdir(ARCHIVE_DIR);
        const modFiles = files.filter(f => f.startsWith('mods-') && f.endsWith('.json'));
        const dates = modFiles.map(f => f.replace('mods-', '').replace('.json', '')).sort();
        return dates;
    } catch {
        return [];
    }
}

async function findOldArchive(minDaysOld = 20) {
    const dates = await getArchivedDates();
    const now = new Date();
    
    for (const dateStr of dates) {
        const archiveDate = new Date(dateStr);
        const daysDiff = (now - archiveDate) / (1000 * 60 * 60 * 24);
        
        if (daysDiff >= minDaysOld) {
            try {
                const archiveData = await fs.readFile(path.join(ARCHIVE_DIR, `mods-${dateStr}.json`), 'utf-8');
                return { dateStr, data: JSON.parse(archiveData), daysDiff };
            } catch {
                continue;
            }
        }
    }
    return null;
}

async function cleanupOldArchives(maxDays = 32) {
    const dates = await getArchivedDates();
    
    if (dates.length <= maxDays) {
        return;
    }
    
    // Delete the oldest archives
    const toDelete = dates.length - maxDays;
    for (let i = 0; i < toDelete; i++) {
        const dateStr = dates[i];
        try {
            await fs.unlink(path.join(ARCHIVE_DIR, `mods-${dateStr}.json`));
            await fs.unlink(path.join(ARCHIVE_DIR, `authors-${dateStr}.json`));
            console.log(`Deleted old archive: ${dateStr}`);
        } catch (err) {
            console.error(`Failed to delete archive ${dateStr}:`, err.message);
        }
    }
}

async function logDataCollection(currentModCount, previousModCount) {
    const timestamp = new Date().toISOString();
    let diff = '';
    
    if (previousModCount !== null) {
        const added = Math.max(0, currentModCount - previousModCount);
        const removed = Math.max(0, previousModCount - currentModCount);
        diff = ` (diff +${added} -${removed})`;
    }
    
    const logEntry = `[${timestamp}] Mods collected ${currentModCount}${diff}\n`;
    
    try {
        await fs.appendFile(LOG_FILE, logEntry, 'utf-8');
        console.log(`Mods collected ${currentModCount}${diff}`);
    } catch (err) {
        console.error('Failed to write to log file:', err.message);
    }
}

async function processMods() {
    // Archive previous data before processing
    await archivePreviousData();
    
    // Get previous mod count for integrity check
    let previousModCount = null;
    try {
        const prevData = await fs.readFile(MODS_OUTPUT_PATH, 'utf-8');
        const prevMods = JSON.parse(prevData);
        previousModCount = prevMods.mods ? prevMods.mods.length : null;
    } catch {
        // No previous data
    }
    
    const filtered = mods.filter(mod => {
        if (mod.links?.websiteUrl?.includes('/modpacks/') || mod.links?.websiteUrl?.includes("/bukkit-plugins/")) return false;

        const hasCreateCategory = Array.isArray(mod.categories) && mod.categories.some(cat => cat.id === 6484);

        const nameStartsWithCreate = typeof mod.name === 'string' && (/^create(?:)\s/.test(mod.name.trim().toLowerCase()));

        return hasCreateCategory || nameStartsWithCreate;
    });

    // Check for archive at least 20 days old
    const oldArchive = await findOldArchive(20);
    let monthlyRateAvailable = false;
    let prevModsMap = new Map();
    let period = 0;
    
    if (oldArchive && oldArchive.daysDiff > 0) {
        monthlyRateAvailable = true;
        period = oldArchive.daysDiff;
        if (oldArchive.data.mods) {
            oldArchive.data.mods.forEach(mod => {
                prevModsMap.set(mod.id, mod.downloadCount || 0);
            });
        }
        console.log(`Found archive from ${oldArchive.dateStr} (${period.toFixed(2)} days ago) for monthly rate calculation`);
    }

    // Map mods with download stats
    const mappedMods = filtered.map(mod => {
        const author = Array.isArray(mod.authors) && mod.authors.length > 0 ? mod.authors[0].name : null;
        const authors = Array.isArray(mod.authors) ? mod.authors.map(a => a.name) : null;
        const downloadCount = typeof mod.downloadCount === 'number' ? mod.downloadCount : 0;
        const createdAt = mod.dateCreated || mod.dateReleased || mod.dateModified;
        const days = createdAt ? daysSince(createdAt) : 1;
        const downloadRate = downloadCount / days;

        const modData = {
            id: mod.id,
            name: mod.name,
            author,
            authors,
            downloadCount,
            downloadRate: Number(downloadRate.toFixed(2)),
            createdAt,
            daysExisting: Number(days.toFixed(2))
        };
        
        // Add monthly download rate if archive is available
        if (monthlyRateAvailable && period > 0) {
            const prevDownloads = prevModsMap.has(mod.id) ? prevModsMap.get(mod.id) : 0;
            const downloadDiff = downloadCount - prevDownloads;
            const monthlyRate = downloadDiff / period;
            modData.downloadRateMonthly = Number(monthlyRate.toFixed(2));
        }
        
        return modData;
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
                    monthlyDownloadRate: 0,
                };
            }
            authorStats[author].downloadCount += mod.downloadCount;
            authorStats[author].mods += 1;
            if (mod.createdAt) authorStats[author].createdAtList.push(mod.createdAt);
            // Sum up monthly download rates for this author
            if (monthlyRateAvailable && mod.downloadRateMonthly !== undefined) {
                authorStats[author].monthlyDownloadRate += mod.downloadRateMonthly;
            }
        }
    });

    // Calculate author download rates (total downloads / avg days since created for their mods)
    const authors = Object.values(authorStats).map(author => {
        const avgDays = author.createdAtList.length
            ? author.createdAtList.map(daysSince).reduce((a, b) => a + b, 0) / author.createdAtList.length
            : 1;
        const authorData = {
            name: author.name,
            downloadCount: author.downloadCount,
            mods: author.mods,
            downloadRate: Number((author.downloadCount / avgDays).toFixed(2)),
            daysExisting: Number(avgDays.toFixed(2))
        };
        
        // Add monthly download rate if available
        if (monthlyRateAvailable) {
            authorData.downloadRateMonthly = Number(author.monthlyDownloadRate.toFixed(2));
        }
        
        return authorData;
    });

    const result = {
        generatedAt: new Date().toISOString(),
        monthlyRate: monthlyRateAvailable ? 'available' : 'unavailable',
        mods: mappedMods
    };

    await fs.writeFile(MODS_OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
    authorFileData = { 
        generatedAt: result.generatedAt, 
        monthlyRate: monthlyRateAvailable ? 'available' : 'unavailable',
        authors 
    };
    await fs.writeFile(AUTHORS_OUTPUT_PATH, JSON.stringify(authorFileData, null, 2), 'utf-8');
    console.log(`Processed ${result.mods.length} mods and saved to ${MODS_OUTPUT_PATH}`);
    console.log(`Saved ${authors.length} unique authors to ${AUTHORS_OUTPUT_PATH}`);
    
    // Log data collection with integrity check
    await logDataCollection(result.mods.length, previousModCount);
    
    // Cleanup old archives (keep only 32 days)
    await cleanupOldArchives(32);
}

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
async function deletePreviousMessages(client, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        console.error('Discord channel not found or not text-based.');
        return;
    }
    // Fetch last 50 messages and delete those sent by this bot
    const messages = await channel.messages.fetch({ limit: 50 });
    const myMessages = messages.filter(msg => msg.author.id === client.user.id);
    for (const msg of myMessages.values()) {
        try {
            await msg.delete();
        } catch (err) {
            console.error('Failed to delete message:', err);
        }
    }
}
async function sendAzerbaijanRanking(authorFileData) {
    // Read authors.json
    const authorsData = authorFileData;
    const authors = authorsData.authors;

    // Find Azerbaijan Technologies and its ranking by downloadRate
    const sorted = [...authors].sort((a, b) => b.downloadRate - a.downloadRate);
    const index = sorted.findIndex(a => a.name.toLowerCase() === 'azerbaijan_tech');
    if (index === -1) {
        console.log('Azerbaijan Technologies not found in author list.');
        return;
    }
    const azTech = sorted[index];
    const climbPercent = Math.ceil(((index+1) / sorted.length) * 100);
    const domination = ((azTech.downloadRate / sorted[0].downloadRate) * 100).toFixed(2);

    const adjacentRankings = sorted.slice(Math.max(0, index - 20), index + 3)
        .map((author, i) => {
            const rank = index - 20 + i;
            const percent = ((author.downloadRate / sorted[0].downloadRate) * 100).toFixed(2);
            const isAztech = author.name.toLowerCase() === 'azerbaijan_tech';
            const surroundFormat = isAztech ? "**" : "";
            return `⇒ ${surroundFormat}#${rank + 1} ${author.name + (isAztech ? " :flag_az: :heart:" : "")}${surroundFormat}\n-# ⠀       ${author.downloadRate} avrg. download/day | ${author.downloadCount} downloads | ${percent}% domination\n`;
        }).join("");
        
    const message = `# Azerbaijan Technologies Ranking\nAzerbaijan Technologies is ranked **#${index + 1}**, **${domination}% domination**, **top ${climbPercent}%** of ${sorted.length} authors\n-# ${azTech.downloadRate} downloads by time | ${azTech.downloadCount} total downloads | ${azTech.mods} mods published\n`;
    console.log(message);

    // Send to Discord
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    client.once('ready', async () => {
        console.log(`Logged in as ${client.user.tag}`);
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (!channel) {
            console.error('Discord channel not found.');
            return;
        }
        // await deletePreviousMessages(client, DISCORD_CHANNEL_ID);
        // Send the message
        if (channel && channel.isTextBased()) {
            await channel.send(message);
            await channel.send(`\n## Rankings:\n`);
            const rankingMessages = adjacentRankings.split("\n");
            let buffer = "";
            for (const line of rankingMessages) {
                if ((buffer + line + "\n").length > 1999) {
                    await channel.send(buffer);
                    buffer = "";
                }
                buffer += line + "\n";
            }
            if (buffer.trim().length > 0) {
                await channel.send(buffer);
            }
            console.log('Sent ranking message to Discord.');
        } else {
            console.error('Discord channel not found or not text-based.');
        }
        client.destroy();
    });
    client.login(DISCORD_TOKEN);
}

processMods().catch(err => {
    console.error('Error processing mods:', err);
}).then(() => {
    sendAzerbaijanRanking(authorFileData).catch(err => {
        console.error('Error sending Discord message:', err);
    });
});