const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageSelectMenu } = require('discord.js');
const { controlnet_model_selection, controlnet_preprocessor_selection, model_selection_xl, model_selection, model_selection_flux, model_selection_legacy, model_selection_chroma, model_selection_flux_klein_4b, model_selection_flux_klein_9b, model_selection_anima, model_selection_lumina, model_selection_qwen_image, model_selection_z_image, sampler_selection, scheduler_selection } = require('../utils/ai_server_config');
const { cached_model } = require('../utils/model_change');
const { clamp, truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');
const { get_model_family_defaults } = require('../utils/model_defaults');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_setting')
        .setDescription('Change your personal generation settings, more to come, i guess')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the personal generation setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the personal generation setting'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the personal generation setting, will persist through generation')
                .addBooleanOption(option =>
                    option.setName('do_preview')
                        .setDescription('Do preview during image generation (default is false, will be slightly slower if true)')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('hires_checkpoint')
                        .setDescription('Force a cached checkpoint to be used in hires (not all option is cached)')
                        .addChoices(
                            ...(model_selection.concat(model_selection_xl).filter(x => !model_selection_legacy.map(y => y.value).includes(x.value))),
                            { name: 'LEGACY MODELS', value: 'legacy' },
                            { name: 'EXPERIMENTAL MODELS', value: 'experimental' }
                        ))
                .addStringOption(option =>
                    option.setName('hires_sampler')
                        .setDescription('Sampler to use for hires (default: Use same sampler)')
                        .addChoices(
                            { name: 'Use same sampler', value: 'Use same sampler' },
                            ...sampler_selection
                        ))
                .addStringOption(option =>
                    option.setName('hires_scheduler')
                        .setDescription('Scheduler to use for hires (default: Use same scheduler)')
                        .addChoices(
                            { name: 'Use same scheduler', value: 'Use same scheduler' },
                            ...scheduler_selection
                        ))
                .addStringOption(option =>
                    option.setName('hires_positive')
                        .setDescription('Extra positive prompt appended during hires (leave empty to use same prompt)'))
                .addStringOption(option =>
                    option.setName('hires_negative')
                        .setDescription('Extra negative prompt appended during hires (leave empty to use same negative)'))
                .addNumberOption(option =>
                    option.setName('hires_cfg')
                        .setDescription('CFG scale for hires (leave unset to use same CFG as base generation)'))
                .addNumberOption(option =>
                    option.setName('hires_shift')
                        .setDescription('Distilled CFG / shift for hires (leave unset to use same shift as base generation)'))
                )

    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.usersetting_config.delete(interaction.user.id)
            await interaction.reply('Personal generation setting has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.usersetting_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");
            }
            else {
                await interaction.reply('No personal generation setting found');
            }
            return
        }

        //parse the options
        const do_preview = interaction.options.getBoolean('do_preview') !== null ? interaction.options.getBoolean('do_preview') : true
        let hires_checkpoint = interaction.options.getString('hires_checkpoint') || null
        let hires_sampler = interaction.options.getString('hires_sampler') || null
        let hires_scheduler = interaction.options.getString('hires_scheduler') || null
        const hires_positive = interaction.options.getString('hires_positive') ?? null
        const hires_negative = interaction.options.getString('hires_negative') ?? null
        let hires_cfg = interaction.options.getNumber('hires_cfg') ?? null
        let hires_shift = interaction.options.getNumber('hires_shift') ?? null

        await interaction.deferReply();

        // Handle legacy and experimental model selections with dropdown
        if (hires_checkpoint === 'legacy') {
            const legacySelectMenu = new MessageSelectMenu()
                .setCustomId('legacy_model_select')
                .setPlaceholder('Select a legacy model')
                .addOptions(model_selection_legacy.map(x => ({
                    label: x.name,
                    value: x.value
                })));
            
            const row = new MessageActionRow().addComponents(legacySelectMenu);
            
            const selectMessage = await interaction.followUp({
                content: 'Select a legacy model from the following list (:warning: Consider using regular models when possible)',
                components: [row],
                fetchReply: true,
            });
            
            try {
                const selectInteraction = await selectMessage.awaitMessageComponent({
                    componentType: 'SELECT_MENU',
                    time: 60000,
                });
                
                hires_checkpoint = selectInteraction.values[0];
                
                await selectInteraction.update({
                    content: `Selected model: ${model_selection_legacy.find(x => x.value === hires_checkpoint)?.name || hires_checkpoint}`,
                    components: [],
                });
            } catch (error) {
                await interaction.editReply('Model selection timed out. Settings not updated.');
                return;
            }
        }
        
        if (hires_checkpoint === 'experimental') {
            const experimental_models = model_selection_flux
                .concat(model_selection_chroma)
                .concat(model_selection_flux_klein_4b)
                .concat(model_selection_flux_klein_9b)
                .concat(model_selection_anima)
                .concat(model_selection_lumina)
                .concat(model_selection_qwen_image)
                .concat(model_selection_z_image)
                .filter(x => !model_selection_legacy.map(y => y.value).includes(x.value));
            
            const experimentalSelectMenu = new MessageSelectMenu()
                .setCustomId('experimental_model_select')
                .setPlaceholder('Select an experimental model')
                .addOptions(experimental_models.map(x => ({
                    label: x.name,
                    value: x.value
                })));
            
            const row = new MessageActionRow().addComponents(experimentalSelectMenu);
            
            const selectMessage = await interaction.followUp({
                content: 'Select an experimental model from the following list (:warning: These models are for testing and may be unstable)',
                components: [row],
                fetchReply: true,
            });
            
            try {
                const selectInteraction = await selectMessage.awaitMessageComponent({
                    componentType: 'SELECT_MENU',
                    time: 60000,
                });
                
                hires_checkpoint = selectInteraction.values[0];
                
                await selectInteraction.update({
                    content: `Selected model: ${experimental_models.find(x => x.value === hires_checkpoint)?.name || hires_checkpoint}`,
                    components: [],
                });
            } catch (error) {
                await interaction.editReply('Model selection timed out. Settings not updated.');
                return;
            }
        }

        //setup the config
        // If user set a hires checkpoint but left sampler/scheduler/cfg/shift unset,
        // fill those in from family defaults so the hires pass uses correct settings.
        if (hires_checkpoint && hires_checkpoint !== 'Use same checkpoint') {
            const hires_family_def = get_model_family_defaults(hires_checkpoint, 't2i')
            if (hires_family_def) {
                if (hires_sampler === null && hires_family_def.sampler)
                    hires_sampler = hires_family_def.sampler
                if (hires_scheduler === null && hires_family_def.scheduler)
                    hires_scheduler = hires_family_def.scheduler
                if (hires_cfg === null && hires_family_def.hr_cfg !== null) {
                    hires_cfg = hires_family_def.hr_cfg  // 1 = distilled model
                    if (hires_shift === null && hires_family_def.hr_dcfg !== null)
                        hires_shift = hires_family_def.hr_dcfg
                }
            }
        }

        const config = {
            do_preview: do_preview,
            hires_checkpoint: hires_checkpoint,
            hires_sampler: hires_sampler,
            hires_scheduler: hires_scheduler,
            hires_positive: hires_positive,
            hires_negative: hires_negative,
            hires_cfg: hires_cfg,
            hires_shift: hires_shift
        }

        const config_string = JSON.stringify(config)

		await interaction.editReply("Personal generation setting has been set");

        client.usersetting_config.set(interaction.user.id, config_string);

	},
};