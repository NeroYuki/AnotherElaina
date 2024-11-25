const { SlashCommandBuilder } = require('@discordjs/builders');
const { truncate, try_parse_json_and_return_formated_string } = require('../utils/common_helper');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_boorugen')
		.setDescription('Output a DanTagGen config string based on the settings, also set as your default config')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the BooruGen config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check the current BooruGen config'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Setup the BooruGen config, will persist through generation')
                .addStringOption(option =>
                    option.setName('gen_length')
                        .setDescription('The length of the generated prompt')
                        .addChoices(
                            { name: 'Very Short', value: 'very short' },
                            { name: 'Short', value: 'short' },
                            { name: 'Long', value: 'long' },
                            { name: 'Very Long', value: 'very long' }
                        )
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('ban_tags')
                        .setDescription('Which tags to be banned from the generated prompt'))
                .addStringOption(option =>
                    option.setName('format')
                        .setDescription('The format of the generated prompt'))
                .addIntegerOption(option =>
                    option.setName('random_seed')
                        .setDescription('The random seed of the generated prompt'))
                .addNumberOption(option =>
                    option.setName('temperature')
                        .setDescription('The temperature of the generated prompt'))
                .addNumberOption(option =>
                    option.setName('top_p')
                        .setDescription('The top_p of the generated prompt'))
                .addNumberOption(option =>
                    option.setName('top_k')
                        .setDescription('The top_k of the generated prompt'))
                .addStringOption(option =>
                    option.setName('tipo_mode')
                        .setDescription('The tipo mode of the generated prompt')
                        .addChoices(
                            { name: 'Natural language only', value: 'NL only (Tag to NL)' },
                            { name: 'Booru Tag first', value: 'Both, tag first (recommend)' },
                            { name: 'Natural language first', value: 'Both, NL first (recommend)' },
                            { name: '+ Generated NL', value: 'Both + generated NL' },
                            { name: 'Follow format', value: 'custom' }
                        ))
                .addStringOption(option =>
                    option.setName('tipo_tag_gen_length')
                        .setDescription('The length of the generated tag')
                        .addChoices(
                            { name: 'Very Short', value: 'very short' },
                            { name: 'Short', value: 'short' },
                            { name: 'Long', value: 'long' },
                            { name: 'Very Long', value: 'very long' }
                        ))
                .addStringOption(option =>
                    option.setName('tipo_nl_gen_length')
                        .setDescription('The length of the generated natural language')
                        .addChoices(
                            { name: 'Very Short', value: 'very short' },
                            { name: 'Short', value: 'short' },
                            { name: 'Long', value: 'long' },
                            { name: 'Very Long', value: 'very long' }
                        ))
        
        )
        
    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.boorugen_config.delete(interaction.user.id)
            await interaction.reply('BooruGen config has been reset');
            return
        }
        else if (interaction.options.getSubcommand() === 'check') {
            const config_string = client.boorugen_config.get(interaction.user.id)
            if (config_string) {
                await interaction.reply("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 2000) + "\`\`\`");
            }
            else {
                await interaction.reply('No Booru gen config set');
            }
            return
        }

        //parse the options
        const gen_length = interaction.options.getString('gen_length') || 'long'
        const ban_tags = interaction.options.getString('ban_tags') || '.*background.*, .*alternate.*, character doll, multiple.*, .*cosplay.*, .*censor.*'
        const format = interaction.options.getString('format') || '<|special|>, <|characters|>, <|copyrights|>, <|artist|>, <|general|>, <|quality|>, <|meta|>, <|rating|>'
        const random_seed = interaction.options.getInteger('random_seed') || -1
        const temperature = clamp(interaction.options.getNumber('temperature') || 1.2, 0.6, 1.5)
        const top_p = clamp(interaction.options.getNumber('top_p') || 0.9, 0.5, 1)
        const top_k = clamp(interaction.options.getNumber('top_k') || 100, 40, 150)
        const tipo_mode = interaction.options.getString('tipo_mode') || 'NL only (Tag to NL)'
        const tipo_tag_gen_length = interaction.options.getString('tipo_tag_gen_length') || 'long'
        const tipo_nl_gen_length = interaction.options.getString('tipo_nl_gen_length') || 'long'

        let config = {
            "gen_length": gen_length,
            "ban_tags": ban_tags,
            "format": format,
            "random_seed": random_seed,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "tipo_mode": tipo_mode,
            "tipo_tag_gen_length": tipo_tag_gen_length,
            "tipo_nl_gen_length": tipo_nl_gen_length
        }

        const config_string = JSON.stringify(config)

		await interaction.reply("BooruGen config has been set");
        await interaction.channel.send("\`\`\`json\n" + truncate(try_parse_json_and_return_formated_string(config_string), 1900) + "\`\`\`");

        client.boorugen_config.set(interaction.user.id, config_string);

	},
};