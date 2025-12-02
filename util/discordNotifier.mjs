import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('./.env') });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_RETAIN_COUNT = Number(process.env.DISCORD_RETAIN_COUNT) || 2;
const DISCORD_DELETE_BATCH = Number(process.env.DISCORD_DELETE_BATCH) || 100;
const DISCORD_DELETE_MAX_FETCH = Number(process.env.DISCORD_DELETE_MAX_FETCH) || 1000;

/**
 * Delete bot messages in a channel while retaining the latest `retainCount` messages.
 * By default it filters to the current month (filterThisMonth=true) and will page through
 * the channel history up to `maxFetch` messages in batches of `batchSize`. Pinned messages
 * are not deleted. This keeps Discord clean by retaining only the most recent messages
 * for the active month.
 */
async function deletePreviousMessages(client, channelId, retainCount = 2, filterThisMonth = true, batchSize = 100, maxFetch = 1000) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        console.error('Discord channel not found or not text-based.');
        return;
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    const accumulatedBotMessages = [];
    let beforeId = undefined;
    let fetchedTotal = 0;
    let reachedBoundary = false;

    // Paginate backward through channel history to collect all bot messages within the same month
    while (fetchedTotal < maxFetch) {
        const fetchLimit = Math.min(batchSize, maxFetch - fetchedTotal);
        const options = { limit: fetchLimit };
        if (beforeId) options.before = beforeId;

        const messages = await channel.messages.fetch(options);
        if (!messages || messages.size === 0) break;

        fetchedTotal += messages.size;
        // collect bot messages in these messages
        for (const msg of messages.values()) {
            // skip pinned messages to be safe
            if (msg.pinned) continue;
            if (msg.author.id === client.user.id) {
                if (filterThisMonth) {
                    const msgDate = new Date(msg.createdTimestamp);
                    if (msgDate.getMonth() === currentMonth && msgDate.getFullYear() === currentYear) {
                        accumulatedBotMessages.push(msg);
                    }
                } else {
                    accumulatedBotMessages.push(msg);
                }
            }
        }

        // Determine oldest message in this page
        const oldestMessage = [...messages.values()].reduce((oldest, cur) => {
            return (!oldest || cur.createdTimestamp < oldest.createdTimestamp) ? cur : oldest;
        }, null);
        if (!oldestMessage) break;

        // If we've encountered messages older than the current month and we were filtering this month: we can stop
        if (filterThisMonth) {
            const oldestDate = new Date(oldestMessage.createdTimestamp);
            if (oldestDate.getFullYear() < currentYear || (oldestDate.getFullYear() === currentYear && oldestDate.getMonth() < currentMonth)) {
                reachedBoundary = true;
            }
        }

        // Prepare the next page 'before' id
        beforeId = oldestMessage.id;

        if (reachedBoundary) break;
        // Small throttle to avoid rate limit heavy operations
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (accumulatedBotMessages.length <= retainCount) {
        console.log(`No excess bot messages to delete (found ${accumulatedBotMessages.length}, keep ${retainCount}).`);
        return;
    }

    // Sort descending (newest -> oldest) and delete older ones beyond retainCount
    const sorted = accumulatedBotMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    const toDelete = sorted.slice(retainCount);
    console.log(`Deleting ${toDelete.length} old bot message(s) from channel ${channelId} (fetched ${fetchedTotal}).`);
    for (const msg of toDelete) {
        try {
            await msg.delete();
            console.log(`Deleted message ${msg.id} ts=${new Date(msg.createdTimestamp).toISOString()}`);
            await new Promise(resolve => setTimeout(resolve, 150));
        } catch (err) {
            console.error(`Failed to delete message ${msg.id}:`, err);
        }
    }
}

async function sendAzerbaijanRanking(authorFileData) {
    // Read modding groups from authors.json
    const authorsData = authorFileData;
    const moddingGroups = authorsData.moddingGroups || [];
    const authors = authorsData.authors || [];

    if (moddingGroups.length === 0) {
        console.log('No modding groups found in author data.');
        return;
    }

    // Calculate total download rate for share percentage
    const totalDownloadRate = moddingGroups.reduce((sum, g) => sum + g.downloadRate, 0);

    // Find Azerbaijan Technologies group and its ranking by downloadRate
    const sorted = [...moddingGroups].sort((a, b) => b.downloadRate - a.downloadRate);
    const index = sorted.findIndex(g => g.authors.some(a => a.toLowerCase() === 'az_tech'));
    if (index === -1) {
        console.log('Azerbaijan Technologies not found in modding groups.');
        return;
    }
    const azTechGroup = sorted[index];
    const topDownloadRate = sorted[0].downloadRate;
    
    // Calculate top share (percentage of top group's download rate)
    const topShare = ((azTechGroup.downloadRate / topDownloadRate) * 100).toFixed(2);
    
    // Calculate share percentage
    const share = ((azTechGroup.downloadRate / totalDownloadRate) * 100).toFixed(2);
    
    // Find az_tech's position in individual authors ranking
    const sortedAuthors = [...authors].sort((a, b) => b.downloadRate - a.downloadRate);
    const authorIndex = sortedAuthors.findIndex(a => a.name.toLowerCase() === 'az_tech');
    const authorRank = authorIndex !== -1 ? authorIndex + 1 : '?';

    const adjacentRankings = sorted.slice(Math.max(0, index - 20), index + 3)
        .map((group, i) => {
            const rank = Math.max(0, index - 20) + i;
            const groupTopShare = ((group.downloadRate / topDownloadRate) * 100).toFixed(2);
            const groupShare = ((group.downloadRate / totalDownloadRate) * 100).toFixed(2);
            const isAzTechGroup = group.authors.some(a => a.toLowerCase() === 'az_tech');
            const surroundFormat = isAzTechGroup ? "**" : "";
            const topModText = group.topMod ? ` | top mod: ${group.topMod.name}` : '';
            return `⇒ ${surroundFormat}#${rank + 1} ${group.name}${surroundFormat}\n-# ⠀       ${group.downloadRate} avrg. download/day | ${groupTopShare}% top share | ${groupShare}% share${topModText}\n`;
        }).join("");
        
    const topModText = azTechGroup.topMod ? azTechGroup.topMod.name : 'N/A';
    const message = `# Create modding group ranking\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${authorRank}** out of **${authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${topShare}% top share | ${share}% share | top mod: ${topModText}\n`;
    console.log(message);

    // Send to Discord
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    if (!DISCORD_TOKEN) {
        console.error('DISCORD_TOKEN not set in environment. Cannot log in to Discord.');
        return;
    }
    if (!DISCORD_CHANNEL_ID) {
        console.error('DISCORD_CHANNEL_ID not set in environment. Cannot find channel to post to.');
        return;
    }
    try {
        await client.login(DISCORD_TOKEN);
        console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (!channel) {
            console.error('Discord channel not found.');
            client.destroy();
            return;
        }
        
        // Try to find and edit previous messages from this month
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();
        
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const myMessages = messages.filter(msg => msg.author.id === client.user.id);

            // Find messages from this month
            const thisMonthMessages = [];
            for (const msg of myMessages.values()) {
                const msgDate = new Date(msg.createdTimestamp);
                if (msgDate.getMonth() === currentMonth && msgDate.getFullYear() === currentYear) {
                    thisMonthMessages.push(msg);
                }
            }
            
            // Sort by creation time (newest first) so we edit the latest messages, not the oldest
            thisMonthMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            
            let message1ToEdit = thisMonthMessages[0];
            let message2ToEdit = thisMonthMessages[1];
            
            const rankingsMessage = `## Rankings:\n${adjacentRankings}`;
            console.log(`Found ${myMessages.size} bot messages in channel ${DISCORD_CHANNEL_ID}, ${thisMonthMessages.length} from this month.`);
            if (message1ToEdit) console.log(`Most recent message to edit: id=${message1ToEdit.id} ts=${new Date(message1ToEdit.createdTimestamp).toISOString()} len=${message1ToEdit.content.length}`);
            if (message2ToEdit) console.log(`Second recent message to edit: id=${message2ToEdit.id} ts=${new Date(message2ToEdit.createdTimestamp).toISOString()} len=${message2ToEdit.content.length}`);
            
            // Try to edit existing messages if found
            if (message1ToEdit && message2ToEdit) {
                try {
                    // Check if new content fits in message limits
                    if (message.length <= 2000 && rankingsMessage.length <= 2000) {
                        // Only edit if content actually changes — helps debugging and reduces churn
                        if (message1ToEdit.content !== message) {
                            await message1ToEdit.edit(message);
                            console.log(`Edited message ${message1ToEdit.id}`);
                        } else {
                            console.log(`Message ${message1ToEdit.id} content unchanged; skipping edit`);
                        }
                        if (message2ToEdit.content !== rankingsMessage) {
                            await message2ToEdit.edit(rankingsMessage);
                            console.log(`Edited message ${message2ToEdit.id}`);
                        } else {
                            console.log(`Message ${message2ToEdit.id} content unchanged; skipping edit`);
                        }
                        console.log('Edited previous messages from this month.');
                        // Delete any excess bot messages (keep latest 2)
                        try {
                            await deletePreviousMessages(client, DISCORD_CHANNEL_ID, DISCORD_RETAIN_COUNT, true, DISCORD_DELETE_BATCH, DISCORD_DELETE_MAX_FETCH);
                        } catch (err) {
                            console.error('Failed to delete excess messages:', err);
                        }
                        client.destroy();
                        return;
                    } else {
                        console.log('New content too long for editing, will send new messages.');
                    }
                } catch (err) {
                    console.error('Failed to edit messages:', err);
                }
            }
        } catch (err) {
            console.error('Error fetching previous messages:', err);
        }
        
            // If we couldn't edit, send new messages
        if (channel && channel.isTextBased()) {
            await channel.send(message);
            
            // Send rankings message (split if necessary)
            if (rankingsMessage.length <= 2000) {
                await channel.send(rankingsMessage);
            } else {
                // Split into multiple messages if too long
                await channel.send('## Rankings:');
                const rankingLines = adjacentRankings.split("\n");
                let buffer = "";
                for (const line of rankingLines) {
                    if ((buffer + line + "\n").length > 1999) {
                        await channel.send(buffer);
                        buffer = "";
                    }
                    buffer += line + "\n";
                }
                if (buffer.trim().length > 0) {
                    await channel.send(buffer);
                }
            }
            console.log('Sent ranking message to Discord.');
            try {
                // There might be old messages beyond the latest two — delete excess older ones.
                await deletePreviousMessages(client, DISCORD_CHANNEL_ID, DISCORD_RETAIN_COUNT, true, DISCORD_DELETE_BATCH, DISCORD_DELETE_MAX_FETCH);
            } catch (err) {
                console.error('Failed to delete excess messages after sending new messages:', err);
            }
        } else {
            console.error('Discord channel not found or not text-based.');
        }
        client.destroy();
    } catch (err) {
        console.error('Discord client error:', err);
        try { client.destroy(); } catch (e) { /* ignore */ }
    }
}

export { sendAzerbaijanRanking, deletePreviousMessages };
