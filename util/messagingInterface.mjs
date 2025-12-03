import { Client, GatewayIntentBits } from 'discord.js';

// Abstract interface for messaging platforms. Implementations must provide:
// - fetchChannel(channelId) -> returns a channel object with `isTextBased`, `messages.fetch`, `send`,
//   and message objects with `edit`, `delete`, `content`, `createdTimestamp`, `id`, `author`, `pinned`.
// - getUserId() -> returns the bot user id.
// - destroy() -> cleanup client.

class DiscordMessenger {
    constructor(options = {}) {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
        this.token = options.token;
        this._loggedIn = false;
    }
    async loginIfNeeded() {
        if (!this._loggedIn) {
            if (!this.token) throw new Error('DISCORD_TOKEN required for DiscordMessenger');
            await this.client.login(this.token);
            this._loggedIn = true;
        }
    }
    async fetchChannel(channelId) {
        await this.loginIfNeeded();
        return await this.client.channels.fetch(channelId);
    }
    getUserId() {
        return this.client.user ? this.client.user.id : null;
    }
    destroy() { try { this.client.destroy(); } catch(e) { /* ignore */ } }
}

class StubMessenger {
    constructor(client) {
        this._client = client; // expected to provide channels.fetch and token not needed
    }
    async fetchChannel(channelId) {
        if (!this._client || !this._client.channelMap) return null;
        const ch = this._client.channelMap.get(channelId);
        return ch;
    }
    getUserId() {
        return this._client && this._client.user ? this._client.user.id : null;
    }
    destroy() { if (this._client && this._client.destroy) this._client.destroy(); }
}

export { DiscordMessenger, StubMessenger };
