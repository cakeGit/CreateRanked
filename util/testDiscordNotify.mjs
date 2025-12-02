import dotenv from 'dotenv';
import path from 'path';
import { sendAzerbaijanRanking, deletePreviousMessages } from './discordNotifier.mjs';
import { Client, GatewayIntentBits } from 'discord.js';

dotenv.config({ path: path.resolve('./.env') });

// Sample data mimicking production authorFileData
const sample = {
    moddingGroups: [
        { name: 'Group A', authors: ['az_tech'], downloadRate: 300, topMod: { name: 'Mod-A' } },
        { name: 'Group B', authors: ['other'], downloadRate: 500, topMod: { name: 'Mod-B' } },
        { name: 'Group C', authors: ['other2'], downloadRate: 200, topMod: { name: 'Mod-C' } }
    ],
    authors: [
        { name: 'az_tech', downloadRate: 300 },
        { name: 'other', downloadRate: 500 }
    ]
};

(async () => {
    try {
        await sendAzerbaijanRanking(sample);
        console.log('sendAzerbaijanRanking completed');
        // Test deletion: create a client and call deletePreviousMessages if available
        if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID) {
            const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
            await client.login(process.env.DISCORD_BOT_TOKEN);
            console.log(`Test client logged in: ${client.user?.tag}`);
            const retainCount = Number(process.env.DISCORD_RETAIN_COUNT) || 2;
            const batch = Number(process.env.DISCORD_DELETE_BATCH) || 100;
            const maxFetch = Number(process.env.DISCORD_DELETE_MAX_FETCH) || 1000;
            await deletePreviousMessages(client, process.env.DISCORD_CHANNEL_ID, retainCount, true, batch, maxFetch);
            client.destroy();
            console.log('deletePreviousMessages test completed');
        }
    } catch (err) {
        console.error('Error in sendAzerbaijanRanking test:', err);
    }
})();
