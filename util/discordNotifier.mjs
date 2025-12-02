import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('./.env') });

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
    
    // Calculate diff to top (difference between top group and current group)
    const diffToTop = (topDownloadRate - azTechGroup.downloadRate).toFixed(2);
    
    // Calculate share percentage
    const share = ((azTechGroup.downloadRate / totalDownloadRate) * 100).toFixed(2);
    
    // Find az_tech's position in individual authors ranking
    const sortedAuthors = [...authors].sort((a, b) => b.downloadRate - a.downloadRate);
    const authorIndex = sortedAuthors.findIndex(a => a.name.toLowerCase() === 'az_tech');
    const authorRank = authorIndex !== -1 ? authorIndex + 1 : '?';

    const adjacentRankings = sorted.slice(Math.max(0, index - 20), index + 3)
        .map((group, i) => {
            const rank = Math.max(0, index - 20) + i;
            const groupDiffToTop = (topDownloadRate - group.downloadRate).toFixed(2);
            const groupShare = ((group.downloadRate / totalDownloadRate) * 100).toFixed(2);
            const isAzTechGroup = group.authors.some(a => a.toLowerCase() === 'az_tech');
            const surroundFormat = isAzTechGroup ? "**" : "";
            const topModText = group.topMod ? ` | top mod: ${group.topMod.name}` : '';
            return `⇒ ${surroundFormat}#${rank + 1} ${group.name}${surroundFormat}\n-# ⠀       ${group.downloadRate} avrg. download/day | ${groupDiffToTop} diff to top | ${groupShare}% share${topModText}\n`;
        }).join("");
        
    const topModText = azTechGroup.topMod ? azTechGroup.topMod.name : 'N/A';
    const message = `# Create modding group ranking\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${authorRank}** out of **${authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${diffToTop} diff to top | ${share}% share | top mod: ${topModText}\n`;
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
            
            // Sort by creation time (oldest first)
            thisMonthMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            let message1ToEdit = thisMonthMessages[0];
            let message2ToEdit = thisMonthMessages[1];
            
            const rankingsMessage = `## Rankings:\n${adjacentRankings}`;
            
            // Try to edit existing messages if found
            if (message1ToEdit && message2ToEdit) {
                try {
                    // Check if new content fits in message limits
                    if (message.length <= 2000 && rankingsMessage.length <= 2000) {
                        await message1ToEdit.edit(message);
                        await message2ToEdit.edit(rankingsMessage);
                        console.log('Edited previous messages from this month.');
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
        } else {
            console.error('Discord channel not found or not text-based.');
        }
        client.destroy();
    });
    client.login(DISCORD_TOKEN);
}

export { sendAzerbaijanRanking, deletePreviousMessages };
