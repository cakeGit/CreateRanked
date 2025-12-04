// Use stub data similar to the test
const authorFileData = {
    moddingGroups: [
        { name: 'Azerbaijan Technologies', authors: ['az_tech'], downloadRate: 1768, topMod: { name: 'Create: Factory' } },
        { name: 'Team Alpha', authors: ['author2'], downloadRate: 1500, topMod: { name: 'Industrial Revolution' } },
        { name: 'Beta Developers', authors: ['author3'], downloadRate: 1200 },
        { name: 'Gamma Studios', authors: ['author4'], downloadRate: 950 },
        { name: 'Delta Creators', authors: ['author5'], downloadRate: 800 },
        { name: 'Epsilon Team', authors: ['author6'], downloadRate: 750 },
        { name: 'Zeta Modding', authors: ['author7'], downloadRate: 700 },
        { name: 'Theta Works', authors: ['author8'], downloadRate: 650 },
        { name: 'Iota Productions', authors: ['author9'], downloadRate: 600 },
        { name: 'Kappa Labs', authors: ['author10'], downloadRate: 550 },
    ],
    authors: [
        { name: 'az_tech', downloadRate: 1768 },
        { name: 'author2', downloadRate: 1500 },
        { name: 'author3', downloadRate: 1200 }
    ]
};

// Expand modding groups to have more entries
for (let i = 0; i < 15; i++) {
    const idx = 10 + i;
    authorFileData.moddingGroups.push({ 
        name: `Team-${idx}`, 
        authors: [`author${idx}`], 
        downloadRate: 500 - (i * 20)
    });
}

const modFileData = {
    mods: Array.from({ length: 25 }, (_, i) => ({ downloadRate: 800 - i * 30 }))
};

const moddingGroups = authorFileData.moddingGroups || [];
const authors = authorFileData.authors || [];
const mods = modFileData.mods || [];

// Calculate total download rate for share percentage of all mods
const totalDownloadRate = mods.reduce((sum, mod) => sum + (mod.downloadRate || 0), 0);

// Find Azerbaijan Technologies group and its ranking by downloadRate
const sorted = [...moddingGroups].sort((a, b) => b.downloadRate - a.downloadRate);
const index = sorted.findIndex(g => g.authors.some(a => a.toLowerCase() === 'az_tech'));
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
const message = `# Create modding group ranking\nStatistics for ${monthName} | Updated <t:${Math.floor(Date.now() / 1000)}:R>\nAz Tech is ranked **#${index + 1}** out of **${sorted.length}** modding groups (**#${authorRank}** out of **${authors.length}** individual authors)\n-# ${azTechGroup.downloadRate} downloads by time | ${topShare}% top share | ${share}% share | top mod: ${topModText}\n`;

// Prepare chunks with the new logic
const fullRankingText = rankingBlocks.join('');
const chunks = [];
let currentText = fullRankingText;

// Simulate existing messages (2 messages with 1900 char capacity each)
const existingMessageCount = 2;
for (let i = 0; i < existingMessageCount; i++) {
    if (currentText.length === 0) break;
    const limit = 1900;
    let splitIndex = limit;
    if (currentText.length > limit) {
        const lastNewline = currentText.lastIndexOf('\n', limit);
        if (lastNewline > -1) splitIndex = lastNewline + 1;
    } else {
        splitIndex = currentText.length;
    }
    chunks.push({ content: currentText.slice(0, splitIndex), isExisting: true });
    currentText = currentText.slice(splitIndex);
}

// Create new chunks if needed (with padding - 1000 chars)
while (currentText.length > 0) {
    const limit = 1000;
    let splitIndex = limit;
    if (currentText.length > limit) {
        const lastNewline = currentText.lastIndexOf('\n', limit);
        if (lastNewline > -1) splitIndex = lastNewline + 1;
    } else {
        splitIndex = currentText.length;
    }
    chunks.push({ content: currentText.slice(0, splitIndex), isExisting: false });
    currentText = currentText.slice(splitIndex);
}

// Simulate message timestamps
const baseTime = new Date();
console.log('\n='.repeat(80));
console.log('SIMULATED DISCORD CHANNEL VIEW');
console.log('='.repeat(80));
console.log('\n');

// Header message (oldest in the channel)
const headerTime = new Date(baseTime - 60000 * 60); // 1 hour ago
console.log(`┌─────────────────────────────────────────────────────────────────────────────┐`);
console.log(`│ Azerbaijan Ranker Bot • ${headerTime.toLocaleString()}                    │`);
console.log(`│ Message ID: msg-header-001 • [EXISTING - EDITED]                          │`);
console.log(`└─────────────────────────────────────────────────────────────────────────────┘`);
console.log(message);
console.log('\n');

// Ranking chunks (newer messages, chronologically after header)
chunks.forEach((chunk, i) => {
    const msgTime = new Date(baseTime - 60000 * (chunks.length - i) * 5); // 5 min intervals
    const status = chunk.isExisting ? '[EXISTING - EDITED]' : '[NEW MESSAGE]';
    const msgId = chunk.isExisting ? `msg-rank-${String(i + 1).padStart(3, '0')}` : `msg-new-${String(i + 1).padStart(3, '0')}`;
    
    console.log(`┌─────────────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ Azerbaijan Ranker Bot • ${msgTime.toLocaleString()}                    │`);
    console.log(`│ Message ID: ${msgId} • ${status.padEnd(25)}                     │`);
    console.log(`│ Size: ${chunk.content.length} / ${chunk.isExisting ? '1900' : '1000'} chars${' '.repeat(chunk.isExisting ? 48 : 49)}│`);
    console.log(`└─────────────────────────────────────────────────────────────────────────────┘`);
    console.log(chunk.content);
    console.log('\n');
});

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total messages: ${chunks.length + 1}`);
console.log(`  - Header: 1 (edited existing)`);
console.log(`  - Ranking chunks (existing/edited): ${chunks.filter(c => c.isExisting).length}`);
console.log(`  - Ranking chunks (newly created): ${chunks.filter(c => !c.isExisting).length}`);
console.log(`Total ranking text length: ${fullRankingText.length} chars`);
console.log('='.repeat(80));
