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
async function sendAzerbaijanRanking() {
    // Read authors.json
    const authorsData = JSON.parse(await fs.readFile(AUTHORS_OUTPUT_PATH, 'utf-8'));
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

sendAzerbaijanRanking().catch(err => {
    console.error('Error sending Discord message:', err);
});