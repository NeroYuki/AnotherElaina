'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { draftImageLayout, unloadLayoutModel } = require('../utils/layout_agent');
const {
    compileLayoutPrompt,
    layoutToCouplerPrompt,
    layoutToCouplerConfig,
    renderLayoutPreview,
} = require('../utils/moss_layout');
const { saveLayout, validateName } = require('../utils/layout_store');

const SESSION_MS = 10 * 60 * 1000;
const ANSWER_MS = 3 * 60 * 1000;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round16(value) {
    return Math.max(16, Math.round(value / 16) * 16);
}

function buildEmbed(draft) {
    const embed = new MessageEmbed()
        .setColor('#4f9cf9')
        .setTitle('Layout draft')
        .setDescription(draft.summary.caption.slice(0, 1500))
        .setFooter({ text: `Qwen 27B · ${draft.width}x${draft.height} · ${draft.items.length} item${draft.items.length === 1 ? '' : 's'}` })
        .setImage('attachment://layout.png');

    draft.items.forEach((item, index) => {
        const text = item.text ? `Text: "${item.text}"\n` : '';
        embed.addField(
            `${index + 1}. ${item.label}`,
            `${text}${item.caption.slice(0, 320)}\nbbox ${item.bbox.join(', ')}`,
            false,
        );
    });
    return embed;
}

function buildRow(sessionId) {
    return new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`${sessionId}:adjust`).setLabel('Adjust').setStyle('PRIMARY'),
        new MessageButton().setCustomId(`${sessionId}:save`).setLabel('Save').setStyle('SUCCESS'),
        new MessageButton().setCustomId(`${sessionId}:coupler`).setLabel('Coupler prompt').setStyle('SECONDARY'),
        new MessageButton().setCustomId(`${sessionId}:cancel`).setLabel('Cancel').setStyle('DANGER'),
    );
}

async function askText(channel, userId, question, time = ANSWER_MS) {
    await channel.send({ content: `<@${userId}> ${question}` }).catch(() => {});
    try {
        const collected = await channel.awaitMessages({
            filter: message => message.author.id === userId && !message.author.bot,
            max: 1,
            time,
            errors: ['time'],
        });
        return collected.first()?.content?.trim() || '';
    }
    catch {
        return '';
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wd_layout_draft')
        .setDescription('Draft a MOSS-Image bbox layout with Qwen 27B, preview it, then adjust or save it')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Describe the composition you want to lay out')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('width')
                .setDescription('Layout canvas width, multiple of 16 (default 1024)')
                .setMinValue(256)
                .setMaxValue(2048))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('Layout canvas height, multiple of 16 (default 1024)')
                .setMinValue(256)
                .setMaxValue(2048)),

    async execute(interaction) {
        const prompt = interaction.options.getString('prompt')?.trim();
        const width = round16(clamp(interaction.options.getInteger('width') || 1024, 256, 2048));
        const height = round16(clamp(interaction.options.getInteger('height') || 1024, 256, 2048));
        if (!prompt) {
            await interaction.reply({ content: 'A non-empty prompt is required.', ephemeral: true });
            return;
        }

        await interaction.deferReply();
        const sessionId = `layout_${interaction.id}`;
        const current = { draft: null, prompt, preview: null };
        let collector = null;
        let closed = false;
        let busy = false;
        let resolveSession;
        const sessionDone = new Promise(resolve => { resolveSession = resolve; });

        const finish = async (content) => {
            if (closed) return;
            closed = true;
            try { collector?.stop(); } catch {}
            await interaction.editReply({ content, embeds: [], files: [], components: [] }).catch(() => {});
            resolveSession();
        };

        try {
            await interaction.editReply({ content: 'Drafting layout with Qwen 27B…' });
            current.draft = await draftImageLayout({ prompt, width, height }, { unload: false });
            current.preview = await renderLayoutPreview(current.draft);
            await interaction.editReply({
                content: null,
                embeds: [buildEmbed(current.draft)],
                files: [{ attachment: current.preview, name: 'layout.png' }],
                components: [buildRow(sessionId)],
            });

            collector = interaction.channel.createMessageComponentCollector({
                filter: component => component.user.id === interaction.user.id &&
                    typeof component.customId === 'string' && component.customId.startsWith(`${sessionId}:`),
                time: SESSION_MS,
            });

            collector.on('collect', async component => {
                const action = component.customId.slice(sessionId.length + 1);
                if (closed) {
                    await component.deferUpdate().catch(() => {});
                    return;
                }
                if (busy) {
                    await component.deferUpdate().catch(() => {});
                    await component.followUp({ content: 'Still working on the previous action…', ephemeral: true }).catch(() => {});
                    return;
                }

                if (action === 'cancel') {
                    busy = true;
                    await component.deferUpdate().catch(() => {});
                    await finish('Layout draft cancelled.');
                    busy = false;
                    return;
                }

                if (action === 'coupler') {
                    busy = true;
                    try {
                        await component.deferUpdate();
                        const couplerPrompt = layoutToCouplerPrompt(current.draft);
                        const config = layoutToCouplerConfig(current.draft);
                        const files = [{
                            attachment: Buffer.from(JSON.stringify(config, null, 2)),
                            name: 'coupler-config.json',
                        }];
                        let content = 'Forge Coupler Advanced mapping ready. Paste this prompt into /wd_create:';
                        if (couplerPrompt.length <= 1600) {
                            content += `\n\`\`\`\n${couplerPrompt}\n\`\`\``;
                        }
                        else {
                            files.push({ attachment: Buffer.from(couplerPrompt), name: 'coupler-prompt.txt' });
                            content += '\nThe prompt is attached as `coupler-prompt.txt` because it is longer than a Discord code block.';
                        }
                        await component.followUp({ content, files, ephemeral: true });
                    }
                    catch (error) {
                        await component.followUp({ content: `Could not build the Coupler prompt: ${error.message}`, ephemeral: true }).catch(() => {});
                    }
                    finally {
                        busy = false;
                    }
                    return;
                }

                if (action === 'save') {
                    busy = true;
                    try {
                        await component.deferUpdate();
                        let name = null;
                        for (let attempt = 0; attempt < 2 && !name; attempt++) {
                            const answer = await askText(
                                component.channel,
                                interaction.user.id,
                                'Name this layout (letters, numbers, hyphen, underscore; max 32 characters).',
                                120_000,
                            );
                            if (!answer) break;
                            try {
                                name = validateName(answer);
                            }
                            catch (error) {
                                await component.followUp({ content: error.message, ephemeral: true }).catch(() => {});
                            }
                        }
                        if (!name) {
                            await component.followUp({ content: 'Layout was not saved because no valid name was provided.', ephemeral: true }).catch(() => {});
                            return;
                        }

                        await saveLayout({
                            userId: interaction.user.id,
                            name,
                            draft: current.draft,
                            sourcePrompt: current.prompt,
                        });

                        const payload = {
                            name,
                            width: current.draft.width,
                            height: current.draft.height,
                            draft: current.draft,
                            moss_prompt: compileLayoutPrompt(current.draft),
                            coupler_prompt: layoutToCouplerPrompt(current.draft),
                        };
                        await component.followUp({
                            content: `Saved layout **${name}**.\nUse it in a prompt with \`<layout:${name}>\`; MOSS receives the JSON layout, while SD/SDXL models receive a Forge Coupler prompt.`,
                            files: [{
                                attachment: Buffer.from(JSON.stringify(payload, null, 2)),
                                name: `layout-${name}.json`,
                            }],
                        });
                        await finish(`Layout saved as **${name}**.`);
                    }
                    catch (error) {
                        await component.followUp({ content: `Could not save the layout: ${error.message}`, ephemeral: true }).catch(() => {});
                    }
                    finally {
                        busy = false;
                    }
                    return;
                }

                if (action === 'adjust') {
                    busy = true;
                    try {
                        await component.deferUpdate();
                        const feedback = await askText(
                            component.channel,
                            interaction.user.id,
                            'Describe the layout change you want (for example: "move the title to the bottom", "make the character larger", "add a small logo in the top-right").',
                        );
                        if (!feedback) {
                            await component.followUp({ content: 'No change request received; the layout was left unchanged.', ephemeral: true }).catch(() => {});
                            return;
                        }
                        const next = await draftImageLayout({
                            prompt: current.prompt,
                            width: current.draft.width,
                            height: current.draft.height,
                            previousDraft: current.draft,
                            feedback,
                        }, { unload: false });
                        current.draft = next;
                        current.preview = await renderLayoutPreview(next);
                        await component.message.edit({
                            embeds: [buildEmbed(current.draft)],
                            files: [{ attachment: current.preview, name: 'layout.png' }],
                            components: [buildRow(sessionId)],
                        });
                    }
                    catch (error) {
                        await component.followUp({ content: `Could not revise the layout: ${error.message}`, ephemeral: true }).catch(() => {});
                    }
                    finally {
                        busy = false;
                    }
                }
            });

            collector.on('end', () => {
                if (!closed) finish('Layout draft expired without a save.').catch(() => {});
            });

            await sessionDone;
        }
        catch (error) {
            await interaction.editReply({ content: `Layout planning failed: ${error.message}`, components: [] }).catch(() => {});
        }
        finally {
            try { collector?.stop(); } catch {}
            await unloadLayoutModel().catch(error => console.log('Failed to unload layout model', error));
        }
    },
};
