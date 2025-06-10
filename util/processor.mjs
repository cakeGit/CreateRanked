import fs from 'fs/promises';
import path from 'path';

const INPUT_PATH = path.resolve('./sourcedata/modIds.json');
const MODS_OUTPUT_PATH = path.resolve('./sourcedata/mods.json');
const AUTHORS_OUTPUT_PATH = path.resolve('./sourcedata/authors.json');

function daysSince(dateString) {
    const created = new Date(dateString);
    const now = new Date();
    const diff = (now - created) / (1000 * 60 * 60 * 24);
    return diff > 0 ? diff : 1; // Avoid division by zero
}

async function processMods() {
    const raw = await fs.readFile(INPUT_PATH, 'utf-8');
    const mods = JSON.parse(raw);

    const filtered = mods.filter(mod => {
        if (mod.links?.websiteUrl?.includes('/modpacks/') || mod.links?.websiteUrl?.includes("/bukkit-plugins/")) return false;

        const hasCreateCategory = Array.isArray(mod.categories) && mod.categories.some(cat => cat.id === 6484);

        const nameStartsWithCreate = typeof mod.name === 'string' && (/^create(?:)\s/.test(mod.name.trim().toLowerCase()));

        return hasCreateCategory || nameStartsWithCreate;
    });

    // Map mods with download stats
    const mappedMods = filtered.map(mod => {
        const author = Array.isArray(mod.authors) && mod.authors.length > 0 ? mod.authors[0].name : null;
        const downloadCount = typeof mod.downloadCount === 'number' ? mod.downloadCount : 0;
        const createdAt = mod.dateCreated || mod.dateReleased || mod.dateModified;
        const days = createdAt ? daysSince(createdAt) : 1;
        const downloadRate = downloadCount / days;

        return {
            id: mod.id,
            name: mod.name,
            author,
            downloadCount,
            downloadRate: Number(downloadRate.toFixed(2)),
            createdAt,
            daysExisting: Number(days.toFixed(2))
        };
    });

    // Collect unique authors with download stats
    const authorStats = {};
    mappedMods.forEach(mod => {
        if (!mod.author) return;
        if (!authorStats[mod.author]) {
            authorStats[mod.author] = {
                name: mod.author,
                downloadCount: 0,
                mods: 0,
                createdAtList: [],
            };
        }
        authorStats[mod.author].downloadCount += mod.downloadCount;
        authorStats[mod.author].mods += 1;
        if (mod.createdAt) authorStats[mod.author].createdAtList.push(mod.createdAt);
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

