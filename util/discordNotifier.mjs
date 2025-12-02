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

    if (moddingGroups.length === 0) {
        console.log('No modding groups found in author data.');
        return;
    }

    // Find Azerbaijan Technologies group and its ranking by downloadRate
    const sorted = [...moddingGroups].sort((a, b) => b.downloadRate - a.downloadRate);
    const index = sorted.findIndex(g => g.authors.some(a => a.toLowerCase() === 'az_tech'));
    if (index === -1) {
        console.log('Azerbaijan Technologies not found in modding groups.');
        return;
    }
    const azTechGroup = sorted[index];
    const climbPercent = Math.ceil(((index+1) / sorted.length) * 100);
    const domination = ((azTechGroup.downloadRate / sorted[0].downloadRate) * 100).toFixed(2);

    const adjacentRankings = sorted.slice(Math.max(0, index - 20), index + 3)
        .map((group, i) => {
            const rank = Math.max(0, index - 20) + i;
            const percent = ((group.downloadRate / sorted[0].downloadRate) * 100).toFixed(2);
            const isAzTechGroup = group.authors.some(a => a.toLowerCase() === 'az_tech');
            const surroundFormat = isAzTechGroup ? "**" : "";
            return `⇒ ${surroundFormat}#${rank + 1} ${group.name}${surroundFormat}\n-# ⠀       ${group.downloadRate} avrg. download/day | ${group.downloadCount} downloads | ${percent}% domination\n`;
        }).join("");
        
    const message = `# Azerbaijan Technologies Ranking\nAzerbaijan Technologies modding group is ranked **#${index + 1}**, **${domination}% domination**, **top ${climbPercent}%** of ${sorted.length} modding groups\n-# ${azTechGroup.downloadRate} downloads by time | ${azTechGroup.downloadCount} total downloads | ${azTechGroup.mods} mods published | ${azTechGroup.authors.length} authors\n`;
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

export { sendAzerbaijanRanking, deletePreviousMessages };
