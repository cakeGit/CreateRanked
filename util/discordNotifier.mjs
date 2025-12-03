import { DiscordMessenger } from './messagingInterface.mjs';
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
async function deletePreviousMessages(messenger, channelId, retainCount = 2, filterThisMonth = true, batchSize = 100, maxFetch = 1000) {
    const channel = await messenger.fetchChannel(channelId);
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
            if (msg.author.id === messenger.getUserId()) {
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

async function sendAzerbaijanRanking(authorFileData, modFileData, messengerOverride = null, channelIdOverride = null) {
    // Read modding groups from authors.json
    const authorsData = authorFileData;
    const moddingGroups = authorsData.moddingGroups || [];
    const authors = authorsData.authors || [];
    const mods = modFileData.mods || [];

    if (moddingGroups.length === 0) {
        console.log('No modding groups found in author data.');
        return;
    }

    // Calculate total download rate for share percentage of all mods
    const totalDownloadRate = mods.reduce((sum, mod) => sum + (mod.downloadRate || 0), 0);

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

    const rankingBlocks = sorted.slice(Math.max(0, index - 20), index + 3)
        .map((group, i) => {
            const rank = Math.max(0, index - 20) + i;
            const groupTopShare = ((group.downloadRate / topDownloadRate) * 100).toFixed(2);
            const groupShare = ((group.downloadRate / totalDownloadRate) * 100).toFixed(2);
            const isAzTechGroup = group.authors.some(a => a.toLowerCase() === 'az_tech');
            const surroundFormat = isAzTechGroup ? "**" : "";
            const topModText = group.topMod ? ` | top mod: ${group.topMod.name}` : '';
            return `⇒ ${surroundFormat}#${rank + 1} ${group.name}${surroundFormat}\n-# ⠀       ${group.downloadRate} avrg. download/day | ${groupTopShare}% top share | ${groupShare}% share${topModText}\n`;
        });
        
    const topModText = azTechGroup.topMod ? azTechGroup.topMod.name : 'N/A';
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    const now = new Date();
    const monthName = monthNames[now.getMonth()];
    const message = `# Create modding group ranking\n*Statistics for ${monthName} | Updated ${now.toLocaleDateString()} *\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${authorRank}** out of **${authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${topShare}% top share | ${share}% share | top mod: ${topModText}\n`;
    console.log(message);

    // Send using an abstract messenger
    let messenger = messengerOverride;
    if (!messenger) {
        if (!DISCORD_TOKEN) {
            console.error('DISCORD_TOKEN not set in environment. Cannot log in to Discord.');
            return;
        }
        messenger = new DiscordMessenger({ token: DISCORD_TOKEN });
        await messenger.loginIfNeeded();
    }
    const channelIdToUse = channelIdOverride || DISCORD_CHANNEL_ID;
    if (!channelIdToUse) {
        console.error('DISCORD_CHANNEL_ID not set in environment nor provided as override. Cannot find channel to post to.');
        messenger.destroy();
        return;
    }
    try {
        // messenger should already be logged in if necessary
        console.log(`Using messenger user id: ${messenger.getUserId()}`);
        const channel = await messenger.fetchChannel(channelIdToUse);
        if (!channel) {
            console.error('Discord channel not found.');
            messenger.destroy();
            return;
        }
        
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const myMessages = messages.filter(msg => msg.author.id === messenger.getUserId());

            // Find messages from this month
            const thisMonthMessages = [];
            for (const msg of myMessages.values()) {
                const msgDate = new Date(msg.createdTimestamp);
                if (msgDate.getMonth() === currentMonth && msgDate.getFullYear() === currentYear) {
                    thisMonthMessages.push(msg);
                }
            }
            
            // Sort by creation time (newest first) so we pick the latest messages
            thisMonthMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            
            // We want to treat the oldest message as header, the rest as ranking blocks.
            const thisMonthAsc = thisMonthMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            let messageHeaderToEdit = null;
            let existingRankingMessages = [];
            if (thisMonthAsc.length > 0) {
                messageHeaderToEdit = thisMonthAsc[0];
                existingRankingMessages = thisMonthAsc.slice(1);
            }

                await deletePreviousMessages(messenger, channelIdToUse, DISCORD_RETAIN_COUNT, true, DISCORD_DELETE_BATCH, DISCORD_DELETE_MAX_FETCH);
            const BLOCKS_PER_MSG = 4; // aim to keep 3-4 blocks per message
            const maxChars = 2000;
            function packBlocks(blocks, maxBlocksPerMessage, maxCharsPerMessage) {
                const packed = [];
                let i = 0;
                while (i < blocks.length) {
                    let current = [];
                    let currentLen = 0;
                    while (i < blocks.length && current.length < maxBlocksPerMessage) {
                        const nextBlock = blocks[i];
                        // if this block alone exceeds max chars, split it by newline into smaller parts
                        if (nextBlock.length > maxCharsPerMessage) {
                            const subLines = nextBlock.split('\n');
                            let subBuf = '';
                            for (const line of subLines) {
                                if ((subBuf + line + '\n').length > maxCharsPerMessage) {
                                    if (subBuf.length > 0) packed.push(subBuf);
                                    subBuf = line + '\n';
                                } else {
                                    subBuf += line + '\n';
                                }
                            }
                            if (subBuf.trim().length > 0) packed.push(subBuf);
                            i++;
                            continue;
                        }
                        if (currentLen + nextBlock.length + 1 <= maxCharsPerMessage) {
                            current.push(nextBlock);
                            currentLen += nextBlock.length + 1; // account for separator
                            i++;
                        } else {
                            break;
                        }
                    }
                    if (current.length > 0) {
                        packed.push(current.join('\n'));
                    } else {
                        // current block itself too big but not split earlier; just slice it
                        const block = blocks[i];
                        for (let start = 0; start < block.length; start += maxCharsPerMessage) {
                            packed.push(block.slice(start, start + maxCharsPerMessage));
                        }
                        i++;
                    }
                }
                return packed;
            }

            const rankingChunks = packBlocks(rankingBlocks, BLOCKS_PER_MSG, maxChars);
            // Ensure we retain enough messages in the channel for header + all ranking chunks
            const requiredMessageCount = 1 + rankingChunks.length; // 1 header + ranking chunks
            const retainCountForDelete = Math.max(DISCORD_RETAIN_COUNT, requiredMessageCount);
            const rankingsMessage = rankingChunks.length > 0 ? `## Rankings:\n${rankingChunks[0]}` : '## Rankings:';
            console.log(`Found ${myMessages.size} bot messages in channel ${channelIdToUse}, ${thisMonthMessages.length} from this month.`);
            if (messageHeaderToEdit) console.log(`Header message to edit: id=${messageHeaderToEdit.id} ts=${new Date(messageHeaderToEdit.createdTimestamp).toISOString()} len=${messageHeaderToEdit.content.length}`);
            if (existingRankingMessages.length > 0) console.log(`Existing ranking messages: ${existingRankingMessages.length}`);
            
            // Try to edit existing messages if found
            if (messageHeaderToEdit) {
                try {
                    // Edit header if needed
                    if (messageHeaderToEdit.content !== message) {
                        if (message.length <= maxChars) {
                            await messageHeaderToEdit.edit(message);
                            console.log(`Edited header message ${messageHeaderToEdit.id}`);
                        } else {
                            console.log(`Header content too long to edit; will send as new header message`);
                        }
                    } else {
                        console.log(`Header message ${messageHeaderToEdit.id} content unchanged; skipping edit`);
                    }

                    // Now edit or create ranking messages according to rankingChunks
                    // We will attempt to edit existing ranking messages in place and create or delete as needed
                    for (let i = 0; i < rankingChunks.length; i++) {
                        const chunk = i === 0 ? `## Rankings:\n${rankingChunks[i]}` : `${rankingChunks[i]}`;
                        const existingMsg = existingRankingMessages[i];
                        if (existingMsg) {
                            if (existingMsg.content !== chunk) {
                                await existingMsg.edit(chunk);
                                console.log(`Edited ranking message ${existingMsg.id}`);
                            } else {
                                console.log(`Ranking message ${existingMsg.id} content unchanged; skipping edit`);
                            }
                        } else {
                            // send new ranking chunk
                            const newMsg = await channel.send(chunk);
                            // small throttle
                            await new Promise(resolve => setTimeout(resolve, 150));
                            existingRankingMessages.push(newMsg);
                            console.log(`Sent new ranking message ${newMsg.id}`);
                        }
                    }

                    // If there are more existing ranking messages than chunks, delete the extras
                    if (existingRankingMessages.length > rankingChunks.length) {
                        for (let i = rankingChunks.length; i < existingRankingMessages.length; i++) {
                            try {
                                await existingRankingMessages[i].delete();
                                console.log(`Deleted extra ranking message ${existingRankingMessages[i].id}`);
                            } catch (err) {
                                console.error(`Failed deleting extra ranking message ${existingRankingMessages[i].id}:`, err);
                            }
                        }
                    }

                    console.log('Edited previous messages from this month.');
                    // Delete any excess bot messages (keep latest DISCORD_RETAIN_COUNT)
                    try {
                        await deletePreviousMessages(messenger, channelIdToUse, retainCountForDelete, true, DISCORD_DELETE_BATCH, DISCORD_DELETE_MAX_FETCH);
                    } catch (err) {
                        console.error('Failed to delete excess messages:', err);
                    }
                    messenger.destroy();
                    return;
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

            // Send ranking chunks; we already packed them to be <= 2000 chars
            if (Array.isArray(rankingChunks) && rankingChunks.length > 0) {
                for (let i = 0; i < rankingChunks.length; i++) {
                    const chunk = i === 0 ? `## Rankings:\n${rankingChunks[i]}` : `${rankingChunks[i]}`;
                    await channel.send(chunk);
                    // small throttle so we don't get rate-limited
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }
            console.log('Sent ranking message to Discord.');
                try {
                // There might be old messages beyond the latest ones — delete excess older ones while keeping
                // at least the number of slots that hold the header + all ranking chunks
                await deletePreviousMessages(messenger, channelIdToUse, retainCountForDelete, true, DISCORD_DELETE_BATCH, DISCORD_DELETE_MAX_FETCH);
            } catch (err) {
                console.error('Failed to delete excess messages after sending new messages:', err);
            }
        } else {
            console.error('Discord channel not found or not text-based.');
        }
        messenger.destroy();
    } catch (err) {
        console.error('Discord client error:', err);
        try { messenger.destroy(); } catch (e) { /* ignore */ }
    }
}

export { sendAzerbaijanRanking, deletePreviousMessages };
