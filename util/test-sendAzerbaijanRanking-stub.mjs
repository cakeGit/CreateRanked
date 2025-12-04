// Ensure env var is set before importing the module below (module reads env at import time)
process.env.DISCORD_CHANNEL_ID = 'stubChannel1';
// Force retain count to 1 for this test so the delete path is exercised
process.env.DISCORD_RETAIN_COUNT = '1';
import { sendAzerbaijanRanking, deletePreviousMessages } from './discordNotifier.mjs';
import { StubMessenger } from './messagingInterface.mjs';

// Sample stub data
const authorFileData = {
    moddingGroups: [
        { name: 'Group A', authors: ['az_tech'], downloadRate: 300, topMod: { name: 'Mod A' } },
        { name: 'Group B', authors: ['author2'], downloadRate: 250, topMod: { name: 'Mod B' } },
        { name: 'Group C', authors: ['author3'], downloadRate: 200 },
        { name: 'Group D', authors: ['author4'], downloadRate: 150 },
        { name: 'Group E', authors: ['author5'], downloadRate: 100 },
        { name: 'Group F', authors: ['author6'], downloadRate: 80 },
        { name: 'Group G', authors: ['author7'], downloadRate: 60 },
        { name: 'Group H', authors: ['author8'], downloadRate: 40 }
    ],
    authors: [
        { name: 'az_tech', downloadRate: 300 },
        { name: 'author2', downloadRate: 250 },
        { name: 'author3', downloadRate: 200 }
    ]
};
    const modFileData = {
    mods: [
        { downloadRate: 300 }, { downloadRate: 250 }, { downloadRate: 200 }, { downloadRate: 150 }, { downloadRate: 100 }, { downloadRate: 80 }, { downloadRate: 60 }, { downloadRate: 40 }
    ]
};

// Expand modding groups to ensure rankingChunks length > DISCORD_RETAIN_COUNT
for (let i = 0; i < 15; i++) {
    const idx = 8 + i;
    authorFileData.moddingGroups.push({ name: `Group-${idx}`, authors: [`author${idx}`], downloadRate: 20 + i});
}

// A small helper to create a fake message object
function fakeMessage(content, authorId, id) {
    return {
        id: id || Math.random().toString(36).slice(2, 10),
        createdTimestamp: Date.now(),
        content,
        author: { id: authorId },
        pinned: false,
        edit(newContent) { this.content = newContent; console.log(`Edited message ${this.id}`); return Promise.resolve(this); },
        delete() { console.log(`Deleted message ${this.id}`); this.deleted = true; return Promise.resolve(); }
    };
}

// Create a fake client and channel with minimal implementation used by sendAzerbaijanRanking
class StubChannel {
    constructor() {
        this.sent = [];
        this._messages = new Map();
    }
    isTextBased() { return true; }
    messages = {
        fetch: async ({ limit, before } = {}) => {
            // emulate fetching messages with optional 'before' cursor and limit
            const arrFull = Array.from(this._messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            let arr;
            if (before) {
                // find index of message with given 'before' id
                const idx = arrFull.findIndex(m => m.id === before);
                if (idx === -1) {
                    arr = [];
                } else {
                    // return messages older than 'before'
                    arr = arrFull.slice(0, idx).slice(-limit || undefined);
                }
            } else {
                // return last 'limit' messages
                arr = arrFull.slice(-limit || undefined);
            }
            // Build a Map-like collection with filter method
            const m = new Map(arr.map(m => [m.id, m]));
            m.filter = function (cb) { return new Map([...m].filter(([, v]) => cb(v))); };
            return m;
        }
    }
    async send(content) {
        const msg = fakeMessage(content, 'botid', (Math.random().toString(36).slice(2, 10)));
        msg.createdTimestamp = Date.now();
        msg.author = { id: 'botid' };
        this._messages.set(msg.id, msg);
        this.sent.push(content);
        // override delete to remove from channel map
        msg.delete = async () => {
            console.log(`Deleted message ${msg.id}`);
            this._messages.delete(msg.id);
            return Promise.resolve();
        };
        console.log(`Sent message ${msg.id}`);
        return msg;
    }
}

class StubClient {
    constructor() {
        this.user = { id: 'botid', tag: 'testbot#0001' };
        this.channelMap = new Map();
    }
    async login(token) { console.log('Stub login called'); }
    destroy() { console.log('Stub client destroyed'); }
    async channelsFetch(id) { return this.channelMap.get(id); }
    async channels() { }
    async channels_fetch(id) { return this.channelMap.get(id); }
    async channels_fetch2(id) { return this.channelMap.get(id); }
    async channels_fetch3(id) { return this.channelMap.get(id); }
    channels = {
        fetch: async (id) => {
            console.log(`StubClient.channels.fetch called for '${id}'`);
            return this.channelMap.get(id);
        }
    }
}

(async function runStub() {
    // Local simulation that mirrors sendAzerbaijanRanking's message packing and editing logic
    const client = new StubClient();
    const channel = new StubChannel();
    client.channelMap.set('stubChannel1', channel);

    // Pre-create some fake messages so we can test edit path
    const now = new Date();
    // header - the latest message in current month
    const headerMsg = fakeMessage('# Old header\nOld content', client.user.id, 'header1');
    headerMsg.createdTimestamp = now - 60000 * 1; // 1 minute ago
    // olderSameMonth - earlier this month
    const olderSameMonth = fakeMessage('## Rankings:\nold same-month message', client.user.id, 'olderSame');
    olderSameMonth.createdTimestamp = now - 60000 * 30; // 30 minutes ago (same month)
    // olderPrevMonth - message from previous month, should NOT be deleted
    const olderPrevMonth = fakeMessage('## Rankings:\nolder month message', client.user.id, 'olderPrev');
    const prevMonth = new Date(now);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    olderPrevMonth.createdTimestamp = prevMonth.getTime();
    // override delete() for pre-created messages to remove them from channel map
    headerMsg.delete = async () => { channel._messages.delete(headerMsg.id); console.log(`Deleted message ${headerMsg.id}`); return Promise.resolve(); };
    olderSameMonth.delete = async () => { channel._messages.delete(olderSameMonth.id); console.log(`Deleted message ${olderSameMonth.id}`); return Promise.resolve(); };
    olderPrevMonth.delete = async () => { channel._messages.delete(olderPrevMonth.id); console.log(`Deleted message ${olderPrevMonth.id}`); return Promise.resolve(); };
    // Add all to channel
    channel._messages.set(headerMsg.id, headerMsg);
    channel._messages.set(olderSameMonth.id, olderSameMonth);
    channel._messages.set(olderPrevMonth.id, olderPrevMonth);

    // Build header message content (mirrors function)
    const sorted = [...authorFileData.moddingGroups].sort((a, b) => b.downloadRate - a.downloadRate);
    const index = sorted.findIndex(g => g.authors.some(a => a.toLowerCase() === 'az_tech'));
    const azTechGroup = sorted[index];
    const topDownloadRate = sorted[0].downloadRate;
    const totalDownloadRate = modFileData.mods.reduce((s, m) => s + (m.downloadRate || 0), 0);
    const topShare = ((azTechGroup.downloadRate / topDownloadRate) * 100).toFixed(2);
    const share = ((azTechGroup.downloadRate / totalDownloadRate) * 100).toFixed(2);
    const topModText = azTechGroup.topMod ? azTechGroup.topMod.name : 'N/A';
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    // const now — declared earlier
    const monthName = monthNames[(new Date()).getMonth()];
    const message = `# Create modding group ranking\n*Statistics for ${monthName} | Updated ${now.toLocaleDateString()} *\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${1}** out of **${authorFileData.authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${topShare}% top share | ${share}% share | top mod: ${topModText}\n`;

    // Build ranking blocks
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

    // The same chunking logic as the module
    function packBlocks(blocks, maxBlocksPerMessage, maxCharsPerMessage) {
        const packed = [];
        let i = 0;
        while (i < blocks.length) {
            let current = [];
            let currentLen = 0;
            while (i < blocks.length && current.length < maxBlocksPerMessage) {
                const nextBlock = blocks[i];
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
                    currentLen += nextBlock.length + 1;
                    i++;
                } else {
                    break;
                }
            }
            if (current.length > 0) packed.push(current.join('\n'));
            else {
                const block = blocks[i];
                for (let start = 0; start < block.length; start += maxCharsPerMessage) {
                    packed.push(block.slice(start, start + maxCharsPerMessage));
                }
                i++;
            }
        }
        return packed;
    }

    const rankingChunks = packBlocks(rankingBlocks, 4, 2000);

    // First, run the real sendAzerbaijanRanking with the stub messenger
    const stubMessenger = new StubMessenger(client);
    console.log('\n--- Running sendAzerbaijanRanking with stub messenger ---');
    try {
        await sendAzerbaijanRanking(authorFileData, modFileData, stubMessenger, 'stubChannel1');
    } catch (err) {
        console.error('sendAzerbaijanRanking threw:', err);
    }
    console.log('\n--- Real function invocation finished (no telemetry) ---\n');

    // New test: verify delete behavior when we have header + older (same month) and retainCount=1
    console.log('\n--- Deletion behavior test ---');
    const hasOlderSameBefore = channel._messages.has(olderSameMonth.id);
    const hasOlderPrevBefore = channel._messages.has(olderPrevMonth.id);
    console.log('Before: olderSameMonth present:', hasOlderSameBefore, 'olderPrevMonth present:', hasOlderPrevBefore);

    // Now explicitly call deletePreviousMessages with retainCount=1 to simulate 'needs 2 but only 1 available'
    console.log('\n--- Explicitly invoking deletePreviousMessages with retainCount=1 ---');
    await deletePreviousMessages(stubMessenger, 'stubChannel1', 1, true, 100, 1000);
    const hasOlderSameAfterDelete = channel._messages.has(olderSameMonth.id);
    const hasOlderPrevAfterDelete = channel._messages.has(olderPrevMonth.id);
    console.log('After explicit delete: olderSameMonth present:', hasOlderSameAfterDelete, 'olderPrevMonth present:', hasOlderPrevAfterDelete);

    // Now run the notifier to ensure it sends the missing ranking message
    console.log('\n--- Now invoking sendAzerbaijanRanking after deletion ---');
    await sendAzerbaijanRanking(authorFileData, modFileData, stubMessenger, 'stubChannel1');
    const hasOlderSameAfter = channel._messages.has(olderSameMonth.id);
    const hasOlderPrevAfter = channel._messages.has(olderPrevMonth.id);
    console.log('After: olderSameMonth present:', hasOlderSameAfter, 'olderPrevMonth present:', hasOlderPrevAfter);
    if (!hasOlderSameAfter && hasOlderPrevAfter) {
        console.log('PASS: older same-month message was deleted; older-month message remained.');
    } else {
        console.log('FAIL: delete behavior did not match expectations.');
    }

    console.log('\n--- Stub test finished ---\nSent messages:');
    console.log(channel.sent);
    console.log('\n--- Channel._messages map (id => content) at end:');
    // Sort by timestamp to see order
    const finalMessages = Array.from(channel._messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const msg of finalMessages) {
        console.log(msg.id, '-', msg.content.substring(0, 50).replace(/\n/g, '\\n'), '...', '-', new Date(msg.createdTimestamp).toISOString());
    }
})();
