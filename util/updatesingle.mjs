import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';
import dotenv from 'dotenv';
import { sendAzerbaijanRanking } from './discordNotifier.mjs';

dotenv.config({ path: path.resolve('./.env') });

const API_KEY = process.env.CURSEFORGE_TOKEN;
const API_URL = 'https://api.curseforge.com/v1/mods/search';

const PAGE_SIZE = 50;
const GAME_ID = 432;
const SEARCH_FILTER = 'create';
const MAX_MODS = parseInt(process.env.MAX_MODS, 10) || 10000;
// Define discovered mods path early to avoid TDZ when used by helpers
const DISCOVERED_MODS_PATH = path.resolve('./data/discoveredModIds.json');

var authorFileData = {};

function logRateLimitHeaders(res, context) {
    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    const retryAfter = res.headers.get('retry-after');

    if (res.status === 429) {
        console.warn(`[RateLimit][${context}] Received 429 Too Many Requests. Remaining=${remaining ?? 'unknown'}, reset=${reset ?? 'unknown'}, retryAfter=${retryAfter ?? 'n/a'}`);
        return;
    }

    if (retryAfter) {
        console.warn(`[RateLimit][${context}] Retry-After header present: ${retryAfter}`);
    }

    if (limit || remaining || reset) {
        const limitText = limit ?? 'unknown';
        const remainingText = remaining ?? 'unknown';
        const resetText = reset ?? 'unknown';
        const message = `[RateLimit][${context}] limit ${limitText}, remaining ${remainingText}, reset ${resetText}`;
        const remainingNumber = Number(remaining);
        if (!Number.isNaN(remainingNumber) && remainingNumber <= 5) {
            console.warn(message);
        } else {
            console.log(message);
        }
    }
}

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

        logRateLimitHeaders(res, `search index ${index}`);

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Failed to fetch mods (status ${res.status}): ${res.statusText}. Body: ${body}`);
        }

        const data = await res.json();
        if (index === 0) {
            totalCount = data.pagination?.totalCount || 0;
            console.log(`Total mods matching search: ${totalCount}`);
        }
        allMods.push(...data.data);
        fetched += data.data.length;
        index += PAGE_SIZE;
    } while (fetched < totalCount && index < MAX_MODS);
    
    if (index >= MAX_MODS && fetched < totalCount) {
        console.log(`Warning: Reached MAX_MODS limit (${MAX_MODS}). Some mods beyond this limit may require recovery.`);
    }

    return allMods;
}

async function fetchModById(modId) {
    console.log(`Fetching mod ${modId} directly from API...`);
    const url = `https://api.curseforge.com/v1/mods/${modId}`;
    const res = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'x-api-key': API_KEY
        }
    });

    logRateLimitHeaders(res, `modId ${modId}`);

    if (!res.ok) {
        const body = await res.text();
        console.error(`Failed to fetch mod ${modId} (status ${res.status}): ${res.statusText}. Body: ${body}`);
        return null;
    }

    const data = await res.json();
    return data.data;
}

async function loadDiscoveredModIds() {
    try {
        const data = await fs.readFile(DISCOVERED_MODS_PATH, 'utf-8');
        return new Set(JSON.parse(data));
    } catch {
        return new Set();
    }
}

async function saveDiscoveredModIds(modIds) {
    await fs.writeFile(DISCOVERED_MODS_PATH, JSON.stringify([...modIds], null, 2), 'utf-8');
}

/**
 * Remove duplicate mods from search results and attempt to recover previously discovered mods
 * that are missing from the current search.
 * @returns {Object} Object containing mods array, recoveredCount, and recoveredMods array with names
 */
async function removeDuplicatesAndRecoverMods(searchMods) {
    // Load previously discovered mod IDs
    const discoveredModIds = await loadDiscoveredModIds();
    
    // Remove duplicates from search results
    const uniqueModsMap = new Map();
    for (const mod of searchMods) {
        if (!uniqueModsMap.has(mod.id)) {
            uniqueModsMap.set(mod.id, mod);
        }
    }
    
    let uniqueMods = Array.from(uniqueModsMap.values());
    const searchModIds = new Set(uniqueMods.map(m => m.id));
    
    // Find mods that were previously discovered but are missing from search
    const missingModIds = [...discoveredModIds].filter(id => !searchModIds.has(id));
    console.log(`[Recovery] Discovered set size=${discoveredModIds.size}, Search unique=${searchModIds.size}, Missing=${missingModIds.length}`);
    if (missingModIds.length > 0) {
        console.log(`[Recovery] Missing ID sample (up to 10): ${missingModIds.slice(0, 10).join(', ')}`);
    } else {
        if (discoveredModIds.size === 0) {
            console.log('[Recovery] No missing mods to recover (discovered set is empty on this run).');
        } else {
            console.log('[Recovery] No previously discovered mods are missing from the current search.');
        }
    }
    
    let recoveredCount = 0;
    const recoveredMods = [];
    const failedModIds = [];
    if (missingModIds.length > 0) {
        console.log(`Found ${missingModIds.length} previously discovered mods missing from search, attempting recovery...`);
        console.log(`Note: Mods may be missing from search due to:`);
        console.log(`  - Search API ranking/relevance changes`);
        console.log(`  - Pagination limits (MAX_MODS=${MAX_MODS})`);
        console.log(`  - Temporary API inconsistencies`);
        
        // Fetch missing mods directly
        for (const modId of missingModIds) {
            console.log(`[Recovery] Attempting to recover modId=${modId} via direct API fetch...`);
            const mod = await fetchModById(modId);
            if (mod) {
                // Basic format/introspection logging to verify structure
                const issues = [];
                if (mod.id !== modId) issues.push(`id mismatch (got ${mod.id})`);
                if (typeof mod.name !== 'string' || !mod.name.trim()) issues.push('invalid name');
                if (!Array.isArray(mod.authors)) issues.push('authors not array');
                if (Array.isArray(mod.authors) && mod.authors.length === 0) issues.push('authors empty');
                if (!Array.isArray(mod.categories)) issues.push('categories not array');
                if (typeof mod.downloadCount !== 'number') issues.push('downloadCount not number');

                const authorsLen = Array.isArray(mod.authors) ? mod.authors.length : 'n/a';
                const categoriesLen = Array.isArray(mod.categories) ? mod.categories.length : 'n/a';
                const namePreview = typeof mod.name === 'string' ? mod.name : String(mod.name);
                console.log(`[Recovery] OK modId=${modId} -> name="${namePreview}" | authors=${authorsLen} | categories=${categoriesLen} | downloads=${mod.downloadCount ?? 'n/a'}`);
                if (issues.length > 0) {
                    console.warn(`[Recovery][modId=${modId}] Potential format issues: ${issues.join('; ')}`);
                }

                uniqueMods.push(mod);
                recoveredMods.push(mod.name);
                recoveredCount++;
            } else {
                console.warn(`[Recovery] Failed to recover modId=${modId}`);
                failedModIds.push(modId);
            }
        }
        
        if (recoveredCount > 0) {
            console.log(`Successfully recovered ${recoveredCount} mod(s): ${recoveredMods.join(', ')}`);
        }
        if (failedModIds.length > 0) {
            console.log(`Failed to fetch ${failedModIds.length} mod(s) with ID(s): ${failedModIds.join(', ')}`);
            console.log(`These mods may have been deleted or made private.`);
        }
    }
    
    const updatedDiscoveredModIds = new Set(discoveredModIds);
    uniqueMods.forEach(mod => updatedDiscoveredModIds.add(mod.id));

    return { mods: uniqueMods, recoveredCount, recoveredMods, discoveredModIds: updatedDiscoveredModIds };
}

var mods;
var recoveredModsCount = 0;
var recoveredModNames = [];
var knownDiscoveredModIds = new Set();
const CREATE_MOD_ID = 328085;

try {
    const searchMods = await fetchAllMods();
    console.log(`Fetched ${searchMods.length} mods from CurseForge API search`);
    
    const result = await removeDuplicatesAndRecoverMods(searchMods);
    mods = result.mods;
    recoveredModsCount = result.recoveredCount;
    recoveredModNames = result.recoveredMods;
    knownDiscoveredModIds = result.discoveredModIds;
    
    console.log(`Total mods after deduplication and recovery: ${mods.length}`);
    
    // Always fetch the original Create mod (ID: 328085) directly
    const hasCreateMod = mods.some(mod => mod.id === CREATE_MOD_ID);
    if (!hasCreateMod) {
        console.log(`[Create Mod] Original Create mod not found in search, fetching directly...`);
        const createMod = await fetchModById(CREATE_MOD_ID);
        if (createMod) {
            console.log(`[Create Mod] Successfully fetched original Create mod: "${createMod.name}"`);
            mods.push(createMod);
            knownDiscoveredModIds.add(CREATE_MOD_ID);
            recoveredModsCount++;
            recoveredModNames.push(createMod.name);
        } else {
            console.warn(`[Create Mod] Failed to fetch original Create mod (ID: ${CREATE_MOD_ID})`);
        }
    } else {
        console.log(`[Create Mod] Original Create mod already present in search results`);
    }
    
    console.log(`Total mods after including Create mod: ${mods.length}`);
} catch (err) {
    console.error('Error fetching mods:', err);
    throw err;
}

const MODS_OUTPUT_PATH = path.resolve('./data/mods.json');
const AUTHORS_OUTPUT_PATH = path.resolve('./data/authors.json');
const ARCHIVE_DIR = path.resolve('./data/archive');
const LOG_FILE = path.resolve('./data/dataCollectionLog.txt');

// Archive configuration constants
const MIN_ARCHIVE_AGE_DAYS = 20;  // Minimum age for archive to be used for monthly rate calculation
const MAX_ARCHIVE_DAYS = 32;      // Maximum number of days to keep in archive

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
    // Get current date in UTC midnight
    const now = new Date();
    const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    
    for (const dateStr of dates) {
        // Parse archiveDate as UTC midnight
        const [year, month, day] = dateStr.split('-').map(Number);
        const archiveDateUTC = Date.UTC(year, month - 1, day);
        const daysDiff = (nowUTC - archiveDateUTC) / (1000 * 60 * 60 * 24);
        
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

/**
 * Log data collection results with detailed information about added, dropped, and recovered mods
 * @param {number} currentModCount - Current number of mods
 * @param {number|null} previousModCount - Previous number of mods (null if first run)
 * @param {number} recoveredCount - Number of mods recovered from direct API queries
 * @param {string[]} recoveredMods - Array of names of recovered mods
 * @param {string[]} addedMods - Array of names of newly added mods
 * @param {string[]} droppedMods - Array of names of dropped mods
 */
async function logDataCollection(currentModCount, previousModCount, recoveredCount = 0, recoveredMods = [], addedMods = [], droppedMods = []) {
    const timestamp = new Date().toISOString();
    let diff = '';
    let diffDetails = '';
    
    if (previousModCount !== null) {
        // Calculate GROSS additions and removals (not NET)
        // This shows all movements including recoveries
        const added = recoveredMods.length + addedMods.length;
        const removed = droppedMods.length;
        diff = ` (diff +${added} -${removed})`;
        
        // Add detailed diff with mod names, showing each mod with +/- prefix
        const modChanges = [];
        
        // Add recovered mods first (with + prefix since they were recovered)
        if (recoveredMods.length > 0) {
            recoveredMods.forEach(name => modChanges.push(`+${name}`));
        }
        
        // Add newly added mods (with + prefix)
        if (addedMods.length > 0) {
            addedMods.forEach(name => modChanges.push(`+${name}`));
        }
        
        // Add dropped mods (with - prefix)
        if (droppedMods.length > 0) {
            droppedMods.forEach(name => modChanges.push(`-${name}`));
        }
        
        if (modChanges.length > 0) {
            diffDetails = `\nDiff: ${modChanges.join(', ')}`;
        }
    }
    
    let recoveryInfo = '';
    if (recoveredCount > 0) {
        recoveryInfo = ` [Recovered ${recoveredCount} mod${recoveredCount > 1 ? 's' : ''} from direct query]`;
    }
    
    const logEntry = `[${timestamp}] Mods collected ${currentModCount}${diff}${recoveryInfo}${diffDetails}\n`;
    
    try {
        await fs.appendFile(LOG_FILE, logEntry, 'utf-8');
        console.log(`Mods collected ${currentModCount}${diff}${recoveryInfo}`);
        if (diffDetails) {
            console.log(diffDetails.trim());
        }
    } catch (err) {
        console.error('Failed to write to log file:', err.message);
    }
}

async function processMods() {
    await archivePreviousData();

    let previousModCount = null;
    const previousModNames = new Map();
    try {
        const prevData = await fs.readFile(MODS_OUTPUT_PATH, 'utf-8');
        const prevMods = JSON.parse(prevData);
        if (Array.isArray(prevMods.mods)) {
            previousModCount = prevMods.mods.length;
            prevMods.mods.forEach(mod => {
                previousModNames.set(mod.id, mod.name);
            });
        }
    } catch {
        // No previous data
    }

    const totalModsBeforeFilter = mods.length;
    const createMods = mods.filter(mod => {
        const websiteUrl = mod.links?.websiteUrl?.toLowerCase() || '';
        if (websiteUrl.includes('/modpacks/') || websiteUrl.includes('/bukkit-plugins/')) {
            return false;
        }

        const hasCreateCategory = Array.isArray(mod.categories) && mod.categories.some(cat => cat.id === 6484);
        const normalizedName = typeof mod.name === 'string' ? mod.name.trim().toLowerCase() : '';
        const nameStartsWithCreate = /^create(:|\s)/.test(normalizedName);

        return mod.id == CREATE_MOD_ID || hasCreateCategory || nameStartsWithCreate;
    });

    const filteredOutCount = totalModsBeforeFilter - createMods.length;
    if (filteredOutCount > 0) {
        console.log(`Filtered out ${filteredOutCount} non-Create mods from ${totalModsBeforeFilter} fetched entries`);
    }

    const archive = await findOldArchive(MIN_ARCHIVE_AGE_DAYS);
    const archiveDownloadCounts = new Map();
    let archivePeriodDays = 0;
    let monthlyRateAvailable = false;

    if (archive) {
        archivePeriodDays = archive.daysDiff;
        if (Array.isArray(archive.data.mods)) {
            archive.data.mods.forEach(mod => {
                archiveDownloadCounts.set(mod.id, mod.downloadCount || 0);
            });
        }
        if (archivePeriodDays > 0) {
            monthlyRateAvailable = true;
            console.log(`Found archive from ${archive.dateStr} (${archivePeriodDays.toFixed(2)} days ago) for monthly rate calculation`);
        } else {
            console.log(`Found archive from ${archive.dateStr} but it is too recent for monthly rate calculation`);
        }
    }

    const enrichedMods = createMods.map(mod => {
        const author = Array.isArray(mod.authors) && mod.authors.length > 0 ? mod.authors[0].name : null;
        const authors = Array.isArray(mod.authors) ? mod.authors.map(a => a.name) : null;
        const downloadCount = typeof mod.downloadCount === 'number' ? mod.downloadCount : 0;
        const createdAt = mod.dateCreated || mod.dateReleased || mod.dateModified;
        const days = createdAt ? daysSince(createdAt) : 1;
        const modData = {
            id: mod.id,
            name: mod.name,
            author,
            authors,
            downloadCount,
            downloadRate: Number((downloadCount / days).toFixed(2)),
            createdAt,
            daysExisting: Number(days.toFixed(2)),
            downloadRateMonthly: null
        };

        if (monthlyRateAvailable) {
            const previousDownloads = archiveDownloadCounts.get(mod.id) || 0;
            const monthlyRate = (downloadCount - previousDownloads) / archivePeriodDays;
            modData.downloadRateMonthly = Number(monthlyRate.toFixed(2));
        }

        return modData;
    });

    const authorStats = new Map();
    enrichedMods.forEach(mod => {
        const authorNames = mod.authors || [];
        authorNames.forEach(name => {
            const stats = authorStats.get(name) || {
                name,
                downloadCount: 0,
                mods: 0,
                totalDays: 0,
                monthlyDownloadRate: 0,
            };
            stats.downloadCount += mod.downloadCount;
            stats.mods += 1;
            stats.totalDays += mod.daysExisting;
            if (monthlyRateAvailable && mod.downloadRateMonthly !== null) {
                stats.monthlyDownloadRate += mod.downloadRateMonthly;
            }
            authorStats.set(name, stats);
        });
    });

    const authors = [...authorStats.values()].map(stats => {
        const averageDays = stats.totalDays > 0 ? stats.totalDays / stats.mods : 1;
        return {
            name: stats.name,
            downloadCount: stats.downloadCount,
            mods: stats.mods,
            downloadRate: Number((stats.downloadCount / averageDays).toFixed(2)),
            daysExisting: Number(averageDays.toFixed(2)),
            downloadRateMonthly: monthlyRateAvailable ? Number(stats.monthlyDownloadRate.toFixed(2)) : null,
        };
    });

    const result = {
        generatedAt: new Date().toISOString(),
        monthlyRate: monthlyRateAvailable ? 'available' : 'unavailable',
        mods: enrichedMods,
    };

    await fs.writeFile(MODS_OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
    authorFileData = {
        generatedAt: result.generatedAt,
        monthlyRate: result.monthlyRate,
        authors,
    };
    await fs.writeFile(AUTHORS_OUTPUT_PATH, JSON.stringify(authorFileData, null, 2), 'utf-8');
    console.log(`Processed ${result.mods.length} mods and saved to ${MODS_OUTPUT_PATH}`);
    console.log(`Saved ${authors.length} unique authors to ${AUTHORS_OUTPUT_PATH}`);

    await saveDiscoveredModIds(knownDiscoveredModIds);
    console.log(`Saved ${knownDiscoveredModIds.size} discovered mod IDs to ${DISCOVERED_MODS_PATH}`);

    const recoveredModNamesSet = new Set(recoveredModNames);
    const currentModIds = new Set(enrichedMods.map(mod => mod.id));
    const addedModNames = [];
    const droppedModNames = [];

    if (previousModNames.size > 0) {
        enrichedMods.forEach(mod => {
            if (!previousModNames.has(mod.id) && !recoveredModNamesSet.has(mod.name)) {
                addedModNames.push(mod.name);
            }
        });

        previousModNames.forEach((name, id) => {
            if (!currentModIds.has(id) && !recoveredModNamesSet.has(name)) {
                droppedModNames.push(name);
            }
        });
    }

    await logDataCollection(result.mods.length, previousModCount, recoveredModsCount, recoveredModNames, addedModNames, droppedModNames);

    await cleanupOldArchives(MAX_ARCHIVE_DAYS);
}

processMods().catch(err => {
    console.error('Error processing mods:', err);
}).then(() => {
    sendAzerbaijanRanking(authorFileData).catch(err => {
        console.error('Error sending Discord message:', err);
    });
});