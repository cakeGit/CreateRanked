import { DiscordMessenger } from './messagingInterface.mjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('./.env') });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

function getWeekOfMonth(date) {
    const day = date.getDate();
    return Math.ceil(day / 7);
}

/**
 * Delete bot messages in a channel while retaining the latest `retainCount` messages.
 * By default it filters to the current month (filterThisMonth=true) and will page through
 * the channel history up to `maxFetch` messages in batches of `batchSize`. Pinned messages
 * are not deleted. This keeps Discord clean by retaining only the most recent messages
 * for the active month.
 */
async function deletePreviousMessages(messenger, channelId, retainCount = 2, filterThisMonth = true, batchSize = 100, maxFetch = 1000, protectedIds = null) {
    const channel = await messenger.fetchChannel(channelId);
    if (!channel || !channel.isTextBased()) {
        console.error('Discord channel not found or not text-based.');
        return;
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    const currentWeek = getWeekOfMonth(currentDate);

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
            if (protectedIds && protectedIds.has(msg.id)) continue;
            if (msg.author.id === messenger.getUserId()) {
                if (filterThisMonth) {
                    const msgDate = new Date(msg.createdTimestamp);
                    if (msgDate.getMonth() === currentMonth && msgDate.getFullYear() === currentYear && getWeekOfMonth(msgDate) === currentWeek) {
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
            const oldestWeek = getWeekOfMonth(oldestDate);
            if (oldestDate.getFullYear() < currentYear || 
                (oldestDate.getFullYear() === currentYear && oldestDate.getMonth() < currentMonth) ||
                (oldestDate.getFullYear() === currentYear && oldestDate.getMonth() === currentMonth && oldestWeek < currentWeek)) {
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
    const currentWeek = getWeekOfMonth(now);
    const message = `# Create modding group ranking\nStatistics for week ${currentWeek} of ${monthName}  | Updated <t:${Math.floor(Date.now() / 1000)}:R>\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${authorRank}** out of **${authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${topShare}% top share | ${share}% share | top mod: ${topModText}\n`;
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
        const currentWeekVal = getWeekOfMonth(currentDate);

        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const myMessages = messages.filter(msg => msg.author.id === messenger.getUserId());

            // Find messages from this week
            const thisWeekMessages = [];
            for (const msg of myMessages.values()) {
                const msgDate = new Date(msg.createdTimestamp);
                if (msgDate.getMonth() === currentMonth && msgDate.getFullYear() === currentYear && getWeekOfMonth(msgDate) === currentWeekVal) {
                    thisWeekMessages.push(msg);
                }
            }
            
            // Sort by creation time (oldest first) to maintain order: Header -> Ranking 1 -> Ranking 2 ...
            thisWeekMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            let messageHeaderToEdit = null;
            let existingRankingMessages = [];
            
            if (thisWeekMessages.length > 0) {
                messageHeaderToEdit = thisWeekMessages[0];
                existingRankingMessages = thisWeekMessages.slice(1);
            }

            // Prepare chunks
            // We want to fit content into existing messages (up to ~1900 chars)
            // But for new messages, we want padding (~1000 chars)
            const fullRankingText = rankingBlocks.join('');
            const chunks = [];
            let currentText = fullRankingText;

            // 1. Fill existing messages
            for (const msg of existingRankingMessages) {
                if (currentText.length === 0) break;
                const limit = 1900; 
                let splitIndex = limit;
                if (currentText.length > limit) {
                    const lastNewline = currentText.lastIndexOf('\n', limit);
                    if (lastNewline > -1) splitIndex = lastNewline + 1;
                } else {
                    splitIndex = currentText.length;
                }
                chunks.push(currentText.slice(0, splitIndex));
                currentText = currentText.slice(splitIndex);
            }

            // 2. Create new chunks if needed (with padding)
            while (currentText.length > 0) {
                const limit = 1000; // ~50% capacity for new messages
                let splitIndex = limit;
                if (currentText.length > limit) {
                    const lastNewline = currentText.lastIndexOf('\n', limit);
                    if (lastNewline > -1) splitIndex = lastNewline + 1;
                } else {
                    splitIndex = currentText.length;
                }
                chunks.push(currentText.slice(0, splitIndex));
                currentText = currentText.slice(splitIndex);
            }

            console.log(`Found ${myMessages.size} bot messages, ${thisWeekMessages.length} from this week.`);
            console.log(`Prepared ${chunks.length} ranking chunks.`);

            // Edit or Send Header
            if (messageHeaderToEdit) {
                if (messageHeaderToEdit.content !== message) {
                    await messageHeaderToEdit.edit(message);
                    console.log(`Edited header message ${messageHeaderToEdit.id}`);
                }
            } else {
                const newHeader = await channel.send(message);
                console.log(`Sent new header message ${newHeader.id}`);
                // Add a small delay to ensure timestamp order if we immediately send more
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Edit or Send Ranking Chunks
            for (let i = 0; i < chunks.length; i++) {
                const chunkContent = chunks[i];
                if (i < existingRankingMessages.length) {
                    // Edit existing
                    const msg = existingRankingMessages[i];
                    if (msg.content !== chunkContent) {
                        await msg.edit(chunkContent);
                        console.log(`Edited ranking message ${msg.id}`);
                    }
                } else {
                    // Send new
                    const newMsg = await channel.send(chunkContent);
                    console.log(`Sent new ranking message ${newMsg.id}`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            // Handle excess existing messages (if any)
            // User requested "dont delete old ever", so we will just clear them or mark them as unused
            if (existingRankingMessages.length > chunks.length) {
                for (let i = chunks.length; i < existingRankingMessages.length; i++) {
                    const msg = existingRankingMessages[i];
                    const placeholder = "-(end of ranking)-";
                    if (msg.content !== placeholder) {
                        await msg.edit(placeholder);
                        console.log(`Cleared excess ranking message ${msg.id}`);
                    }
                }
            }

        } catch (err) {
            console.error('Error managing messages:', err);
        }
        
        messenger.destroy();
    } catch (err) {
        console.error('Discord client error:', err);
        try { messenger.destroy(); } catch (e) { /* ignore */ }
    }
}

export { sendAzerbaijanRanking, deletePreviousMessages };
