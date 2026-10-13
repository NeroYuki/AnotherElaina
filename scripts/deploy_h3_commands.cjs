require('dotenv').config();
const fs = require('fs');
const { clientId, guildIds = [] } = require('../config.json');
const { H3_MAX_SECONDS } = require('../utils/comfy_media');
const names = process.argv.includes('--ref-only') ? ['wd_ref2vid'] : ['wd_txt2vid', 'wd_img2vid', 'wd_ref2vid'];
const apply = process.argv.includes('--apply');
async function request(route, method = 'GET', body) {
    const response = await fetch(`https://discord.com/api/v10/applications/${clientId}${route}`, {
        method, headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Discord ${method} returned HTTP ${response.status}`);
    return response.json();
}
async function main() {
    if (!process.env.DISCORD_BOT_TOKEN) throw new Error('No bot token configured.');
    const scopes = [];
    for (const [label, route] of [['global', '/commands'], ...guildIds.map((_id, i) => [`test guild ${i + 1}`, `/guilds/${_id}/commands`])]) {
        const current = await request(route);
        const matches = current.filter(command => names.includes(command.name));
        console.log(`${label}: ${matches.map(command => command.name).join(', ') || 'no existing video commands'}`);
        if (matches.length) scopes.push({ label, route, matches });
    }
    if (!apply) return;
    if (!scopes.length) throw new Error('No existing video-command deployment scope; deployment target needs user selection.');
    fs.mkdirSync('temp', { recursive: true });
    fs.writeFileSync(`temp/h3-discord-schema-backup-${Date.now()}.json`, JSON.stringify(scopes, null, 2));
    for (const scope of scopes) for (const name of names) {
        const data = require(`../commands/${name}`).data.toJSON();
        const current = scope.matches.find(command => command.name === name);
        if (scope.matches.some(command => command.description.startsWith('[DEBUG]'))) data.description = `[DEBUG] ${data.description}`;
        await request(current ? `${scope.route}/${current.id}` : scope.route, current ? 'PATCH' : 'POST', data);
        console.log(`${scope.label}: registered ${name}`);
    }
    for (const scope of scopes) {
        const actual = await request(scope.route);
        for (const name of names) {
            const command = actual.find(item => item.name === name);
            const duration = command?.options?.find(option => option.name === (name === 'wd_txt2vid' ? 'custom_length' : 'length'));
            if (duration?.max_value !== H3_MAX_SECONDS) throw new Error(`${scope.label}: ${name} duration registration did not persist`);
        }
        console.log(`${scope.label}: verified 60-second options for all video commands`);
    }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
