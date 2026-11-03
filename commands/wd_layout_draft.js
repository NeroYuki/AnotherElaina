'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const layoutAgent = require('../utils/layout_agent');
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

function abortRace(signal) {
    let onAbort;
    const promise = new Promise(resolve => {
        onAbort = () => resolve(null);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
    return {
        promise,
        cleanup() {
            signal?.removeEventListener?.('abort', onAbort);
        },
    };
}

/**
 * Ask for a channel message, but return null as soon as the session closes.
 * The underlying awaitMessages collector may keep running until its own
 * timeout; its rejection is handled here so a late answer can never resume
 * work after the session has finished.
 */
async function askText(channel, userId, question, time = ANSWER_MS, signal) {
    const abort = abortRace(signal);
    try {
        await Promise.race([
            channel.send({ content: `<@${userId}> ${question}` }).catch(() => {}),
            abort.promise,
        ]);
        if (signal?.aborted) return null;

        const answer = Promise.resolve(channel.awaitMessages({
            filter: message => message.author.id === userId && !message.author.bot,
            max: 1,
            time,
            errors: ['time'],
        }))
            .then(collected => collected.first()?.content?.trim() || '')
            .catch(() => '');
        return await Promise.race([answer, abort.promise]);
    }
    finally {
        abort.cleanup();
    }
}

async function drainPending(pending) {
    while (pending.size > 0) {
        await Promise.allSettled([...pending]);
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
        const abortController = new AbortController();
        const pendingHandlers = new Set();
        let collector = null;
        let closed = false;
        let closePromise = null;
        let closeEditFailed = false;
        let staleControls = false;
        let busy = false;
        let resolveSession;
        const sessionDone = new Promise(resolve => { resolveSession = resolve; });

        const editReplySafe = (payload) => {
            try {
                return Promise.resolve(interaction.editReply(payload)).then(() => true, () => false);
            }
            catch {
                return Promise.resolve(false);
            }
        };

        const close = (content) => {
            if (closePromise) return closePromise;
            closed = true;
            try { abortController.abort(); } catch {}
            try { collector?.stop(); } catch {}
            closePromise = editReplySafe({ content, embeds: [], files: [], components: [] })
                .then(ok => {
                    if (!ok) closeEditFailed = true;
                    resolveSession();
                });
            return closePromise;
        };

        const followUp = async (component, payload) => {
            if (closed) return;
            await component.followUp(payload).catch(() => {});
        };

        const handleComponent = async (component) => {
            const action = component.customId.slice(sessionId.length + 1);
            if (closed) {
                await component.deferUpdate().catch(() => {});
                return;
            }
            if (busy) {
                await component.deferUpdate().catch(() => {});
                await followUp(component, { content: 'Still working on the previous action…', ephemeral: true });
                return;
            }

            busy = true;
            try {
                await component.deferUpdate().catch(() => {});
                if (closed) return;

                if (action === 'cancel') {
                    await close('Layout draft cancelled.');
                    return;
                }

                if (action === 'coupler') {
                    try {
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
                        await followUp(component, { content, files, ephemeral: true });
                    }
                    catch (error) {
                        await followUp(component, { content: `Could not build the Coupler prompt: ${error.message}`, ephemeral: true });
                    }
                    return;
                }

                if (action === 'save') {
                    try {
                        let name = null;
                        for (let attempt = 0; attempt < 2 && !name; attempt++) {
                            const answer = await askText(
                                component.channel,
                                interaction.user.id,
                                'Name this layout (letters, numbers, hyphen, underscore; max 32 characters).',
                                120_000,
                                abortController.signal,
                            );
                            if (closed || answer === null) return;
                            if (!answer) break;
                            try {
                                name = validateName(answer);
                            }
                            catch (error) {
                                await followUp(component, { content: error.message, ephemeral: true });
                            }
                        }
                        if (closed) return;
                        if (!name) {
                            await followUp(component, { content: 'Layout was not saved because no valid name was provided.', ephemeral: true });
                            return;
                        }

                        await saveLayout({
                            userId: interaction.user.id,
                            name,
                            draft: current.draft,
                            sourcePrompt: current.prompt,
                        });
                        if (closed) return;

                        const payload = {
                            name,
                            width: current.draft.width,
                            height: current.draft.height,
                            draft: current.draft,
                            moss_prompt: compileLayoutPrompt(current.draft),
                            coupler_prompt: layoutToCouplerPrompt(current.draft),
                        };
                        await followUp(component, {
                            content: `Saved layout **${name}**.\nUse it in a prompt with \`<layout:${name}>\`; MOSS receives the JSON layout, while SD/SDXL models receive a Forge Coupler prompt.`,
                            files: [{
                                attachment: Buffer.from(JSON.stringify(payload, null, 2)),
                                name: `layout-${name}.json`,
                            }],
                        });
                        if (closed) return;
                        await close(`Layout saved as **${name}**.`);
                    }
                    catch (error) {
                        await followUp(component, { content: `Could not save the layout: ${error.message}`, ephemeral: true });
                    }
                    return;
                }

                if (action === 'adjust') {
                    try {
                        const feedback = await askText(
                            component.channel,
                            interaction.user.id,
                            'Describe the layout change you want (for example: "move the title to the bottom", "make the character larger", "add a small logo in the top-right").',
                            ANSWER_MS,
                            abortController.signal,
                        );
                        if (closed || feedback === null) return;
                        if (!feedback) {
                            await followUp(component, { content: 'No change request received; the layout was left unchanged.', ephemeral: true });
                            return;
                        }
                        const next = await layoutAgent.draftImageLayout({
                            prompt: current.prompt,
                            width: current.draft.width,
                            height: current.draft.height,
                            previousDraft: current.draft,
                            feedback,
                        }, { unload: true, signal: abortController.signal });
                        if (closed) return;
                        const preview = await renderLayoutPreview(next);
                        if (closed) return;
                        current.draft = next;
                        current.preview = preview;
                        await component.message.edit({
                            embeds: [buildEmbed(current.draft)],
                            files: [{ attachment: current.preview, name: 'layout.png' }],
                            components: [buildRow(sessionId)],
                        });
                        if (closed) staleControls = true;
                    }
                    catch (error) {
                        await followUp(component, { content: `Could not revise the layout: ${error.message}`, ephemeral: true });
                    }
                }
            }
            finally {
                busy = false;
            }
        };

        try {
            await interaction.editReply({ content: 'Drafting layout with Qwen 27B…' });
            if (closed) return;
            current.draft = await layoutAgent.draftImageLayout({ prompt, width, height }, { unload: true });
            if (closed) return;
            current.preview = await renderLayoutPreview(current.draft);
            if (closed) return;
            await interaction.editReply({
                content: null,
                embeds: [buildEmbed(current.draft)],
                files: [{ attachment: current.preview, name: 'layout.png' }],
                components: [buildRow(sessionId)],
            });
            if (closed) return;

            collector = interaction.channel.createMessageComponentCollector({
                filter: component => component.user.id === interaction.user.id &&
                    typeof component.customId === 'string' && component.customId.startsWith(`${sessionId}:`),
                time: SESSION_MS,
            });

            collector.on('collect', component => {
                let task;
                task = handleComponent(component)
                    .catch(error => console.log('Layout component handler failed', error))
                    .finally(() => { pendingHandlers.delete(task); });
                pendingHandlers.add(task);
                return task;
            });

            collector.on('end', () => {
                if (!closed) close('Layout draft expired without a save.').catch(() => {});
            });

            await sessionDone;
        }
        catch (error) {
            if (!closed) {
                await editReplySafe({ content: `Layout planning failed: ${error.message}`, components: [] });
            }
        }
        finally {
            try { collector?.stop(); } catch {}
            await drainPending(pendingHandlers);
            if (closed && (staleControls || closeEditFailed)) {
                await editReplySafe({ components: [] });
            }
            const unload = typeof layoutAgent.unloadLayoutModelQueued === 'function'
                ? layoutAgent.unloadLayoutModelQueued
                : layoutAgent.unloadLayoutModel;
            await Promise.resolve()
                .then(() => unload())
                .catch(error => console.log('Failed to unload layout model', error));
        }
    },
};
