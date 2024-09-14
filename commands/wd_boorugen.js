const { SlashCommandBuilder } = require('@discordjs/builders');

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
                .setDescription('Which tags to be banned from the generated prompt')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('format')
                .setDescription('The format of the generated prompt')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('temperature')
                .setDescription('The temperature of the generated prompt')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('top_p')
                .setDescription('The top_p of the generated prompt')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('top_k')
                .setDescription('The top_k of the generated prompt')
                .setRequired(false))
    ,

	async execute(interaction, client) {

        if (interaction.options.getSubcommand() === 'reset') {
            client.boorugen_config.delete(interaction.user.id)
            await interaction.reply('BooruGen config has been reset');
            return
        }
        //parse the options
        const gen_length = interaction.options.getString('gen_length') || 'long'
        const ban_tags = interaction.options.getString('ban_tags') || '.*background.*, .*alternate.*, character doll, multiple.*, .*cosplay.*, .*censor.*'
        const format = interaction.options.getString('format') || '<|special|>, <|characters|>, <|copyrights|>, <|artist|>, <|general|>, <|quality|>, <|meta|>, <|rating|>'
        const temperature = clamp(interaction.options.getNumber('temperature') || 1.2, 0.6, 1.5)
        const top_p = clamp(interaction.options.getNumber('top_p') || 0.9, 0.5, 1)
        const top_k = clamp(interaction.options.getNumber('top_k') || 100, 40, 150)

        let config = {
            "gen_length": gen_length,
            "ban_tags": ban_tags,
            "format": format,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k
        }

        const config_string = JSON.stringify(config)

		await interaction.reply(config_string);

        client.boorugen_config.set(interaction.user.id, config_string);

	},
};