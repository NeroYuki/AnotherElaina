const { SlashCommandBuilder } = require('@discordjs/builders');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const axios = require('axios');
const databaseConnection = require('../database/database_connection');

function generateTempPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function generateDeviceId(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function hashPassword(password) {
    return crypto.createHash('md5').update(password + 'taikotaiko').digest('hex');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your osu!droid account using your existing ElainaDB bind'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const discordId = interaction.user.id;

        // Look up the user in ElainaDB
        const elainaDb = databaseConnection.getElainaConnection();
        if (!elainaDb) {
            return interaction.editReply({ content: 'Database connection is not ready. Please try again later.' });
        }

        let userbind;
        try {
            userbind = await elainaDb.collection('userbind').findOne({ discordid: discordId });
        } catch (err) {
            console.error('[register] ElainaDB error:', err);
            return interaction.editReply({ content: 'Failed to look up your account. Please try again later.' });
        }

        if (!userbind) {
            return interaction.editReply({ content: 'You do not have an osu!droid account bound in ElainaDB. Please bind your account first.' });
        }

        const { uid } = userbind;

        // Fetch up-to-date profile from the osu!droid API
        let profile;
        try {
            const response = await axios.get(`https://new.osudroid.moe/api2/frontend/profile-uid/${uid}`);
            profile = response.data;
        } catch (err) {
            console.error('[register] osu!droid API error:', err);
            return interaction.editReply({ content: 'Failed to fetch your osu!droid profile. Please try again later.' });
        }

        const username = profile.Username;
        if (!username || username.length < 2 || username.length > 63) {
            return interaction.editReply({ content: `Your osu!droid username \`${username}\` is not compatible with account registration (must be 2–63 characters).` });
        }

        // Connect to MySQL and register
        let connection;
        try {
            connection = await mysql.createConnection({
                host: process.env.OSUDROID_DB_HOST || 'localhost',
                user: process.env.OSUDROID_DB_USER || 'osudroid_user',
                password: process.env.OSUDROID_DB_PASSWORD,
                database: 'osudroid_db',
                charset: 'utf8mb4'
            });

            // Check if already registered
            const [existing] = await connection.execute(
                'SELECT id, password FROM bbl_user WHERE username = ?',
                [username]
            );
            if (existing.length > 0) {
                const existingUser = existing[0];
                if (existingUser.password !== '') {
                    return interaction.editReply({ content: `An account with username \`${username}\` is already registered.` });
                }

                // Account exists but password is empty — reset with a new temporary password
                const tempPassword = generateTempPassword();
                const hashed = hashPassword(tempPassword);
                await connection.execute(
                    'UPDATE bbl_user SET password = ? WHERE id = ?',
                    [hashed, existingUser.id]
                );
                return interaction.editReply({
                    content: [
                        `Your account was found but had no password set. A new temporary password has been generated!`,
                        ``,
                        `**Username:** \`${username}\``,
                        `**Temporary Password:** \`${tempPassword}\``,
                        ``,
                        `> ⚠️ **This password will only be shown once and cannot be retrieved again.**`,
                        `> Please copy it down now, then log in and change your password immediately.`
                    ].join('\n')
                });
            }

            const tempPassword = generateTempPassword();
            const hashed = hashPassword(tempPassword);
            const deviceId = generateDeviceId();
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const email = `${uid}@osudroid.local`;

            // Accuracy is stored as a float ratio (e.g. 0.954 for 95.4%), matching the bbl_user schema
            const accuracy = profile.OverallAccuracy ?? 0;

            await connection.execute(
                `INSERT INTO bbl_user
                 (username, password, email, deviceid, score, pp, playcount, accuracy,
                  regist_time, regist_ip, region, active, supporter, game_session_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)`,
                [
                    username,
                    hashed,
                    email,
                    deviceId,
                    profile.OverallScore ?? 0,
                    profile.OverallPP ?? 0,
                    profile.OverallPlaycount ?? 0,
                    accuracy,
                    now,
                    '127.0.0.1',
                    profile.Region ?? '',
                    profile.Supporter ?? 0
                ]
            );

            await interaction.editReply({
                content: [
                    `Your osu!droid account has been registered!`,
                    ``,
                    `**Username:** \`${username}\``,
                    `**Temporary Password:** \`${tempPassword}\``,
                    ``,
                    `> ⚠️ **This password will only be shown once and cannot be retrieved again.**`,
                    `> Please copy it down now, then log in and change your password immediately.`
                ].join('\n')
            });
        } catch (err) {
            console.error('[register] MySQL error:', err);
            await interaction.editReply({ content: 'Failed to register account due to a database error. Please try again later.' });
        } finally {
            if (connection) await connection.end();
        }
    }
};
