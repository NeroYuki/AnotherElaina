const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_create')
		.setDescription('Create an AI art via my own Stable Diffusion Web UI instance')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('The prompt for the AI to generate art from')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('neg_prompt')
                .setDescription('The negative prompt for the AI to avoid generate art from'))
        .addIntegerOption(option => 
            option.setName('width')
                .setDescription('The width of the generated image (default is 512, recommended max is 768)'))
        .addIntegerOption(option =>
            option.setName('height')
                .setDescription('The height of the generated image (default is 512, recommended max is 768)'))
        .addStringOption(option => 
            option.setName('sampler')
                .setDescription('The sampling method for the AI to generate art from (default is "Euler a")')
                .addChoices(
					{ name: 'Euler a', value: 'Euler a' },
                    { name: 'Euler', value: 'Euler' },
                    { name: 'Heun', value: 'Heun' },
                    { name: 'LMS', value: 'LMS' },
                    { name: 'DPM2', value: 'DPM2' },
				))
        .addNumberOption(option => 
            option.setName('cfg_scale')
                .setDescription('Lower value = more creative freedom (default is 7, recommended max is 10)'))
        .addIntegerOption(option =>
            option.setName('sampling_step')
                .setDescription('More sampling step = longer generation (default is 20, recommended max is 40)'))
        .addStringOption(option => 
            option.setName('seed')
                .setDescription('Random seed for AI generate art from (default is "-1 - Random")'))
        .addBooleanOption(option =>
            option.setName('override_neg_prompt')
                .setDescription('Override the default negative prompt (default is "false")'))
        .addBooleanOption(option => 
            option.setName('remove_nsfw_restriction')
                .setDescription('Force the removal of nsfw negative prompt (default is "false")'))
        .addNumberOption(option =>
            option.setName('upscale_multiplier')
                .setDescription('The rate to upscale the generated image (default is "1, no upscaling")'))
        .addStringOption(option =>
            option.setName('upscaler')
                .setDescription('Specify the upscaler to use (default is "Latent")')
                .addChoices(
					{ name: 'Latent', value: 'Latent' },
                    { name: 'Lanczos', value: 'Lanczos' },
                    { name: 'ESRGAN_4x', value: 'ESRGAN_4x' },
                    { name: 'R-ESRGAN 4x+ Anime6B', value: 'R-ESRGAN 4x+ Anime6B' },
                    { name: 'SwinIR 4x', value: 'SwinIR 4x' },
				))
        .addNumberOption(option =>
            option.setName('upscale_denoise_strength')
                .setDescription('Lower to 0 mean nothing should change, higher to 1 may output unrelated image (default is "0.7")'))
    ,

	async execute(interaction) {
		const prompt = interaction.options.getString('prompt')
		let neg_prompt = interaction.options.getString('neg_prompt') || '' 
        const width = clamp(interaction.options.getInteger('width') || 512, 64, 2048)
        const height = clamp(interaction.options.getInteger('height') || 512, 64, 2048)
        const sampler = interaction.options.getString('sampler') || 'Euler a'
        const cfg_scale = clamp(interaction.options.getNumber('cfg_scale') || 7, 0, 30)
        const sampling_step = clamp(interaction.options.getInteger('sampling_step') || 20, 1, 100)
        const override_neg_prompt = interaction.options.getBoolean('override_neg_prompt') || false
        const remove_nsfw_restriction = interaction.options.getBoolean('remove_nsfw_restriction') || false
        const upscale_multiplier = clamp(interaction.options.getNumber('upscale_multiplier') || 1, 1, 4)
        const upscaler = interaction.options.getString('upscaler') || 'Latent'
        const upscale_denoise_strength = clamp(interaction.options.getNumber('upscale_denoise_strength') || 0.7, 0, 1)
        let seed = -1
        try {
            seed = parseInt(interaction.options.getString('seed')) || parseInt('-1')
        }
        catch {
            seed = parseInt('-1')
        }

        // add default neg prompt
        const default_neg_prompt = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry,missing fingers,bad hands,missing arms, long neck, '
        if (!override_neg_prompt) {
            neg_prompt = default_neg_prompt + neg_prompt
        }

        // add nsfw as neg prompt by default
        if (!remove_nsfw_restriction) {
            neg_prompt = 'nsfw, ' + neg_prompt
        }

		//make a temporary reply to not get timeout'd
		await interaction.deferReply();

        const option = {
            method: 'POST',
            body: JSON.stringify({
                fn_index: 61,
                data: [
                    prompt,                 // prompt
                    neg_prompt,             // neg_prompt
                    "None",                 
                    "None",
                    sampling_step,
                    sampler,
                    false,
                    false,
                    1,
                    1,
                    cfg_scale,
                    seed,
                    -1,
                    0,
                    0,
                    0,
                    false,
                    height,
                    width,
                    (upscale_multiplier > 1) ? true : false, //hires fix
                    upscale_denoise_strength, //upscale denoise strength
                    upscale_multiplier, // upscale ratio
                    upscaler, //upscaler
                    0,
                    0,
                    0,
                    "None",
                    "<div class=\"dynamic-prompting\">\n    <h3><strong>Combinations</strong></h3>\n\n    Choose a number of terms from a list, in this case we choose two artists: \n    <code class=\"codeblock\">{2$$artist1|artist2|artist3}</code><br/>\n\n    If $$ is not provided, then 1$$ is assumed.<br/><br/>\n\n    If the chosen number of terms is greater than the available terms, then some terms will be duplicated, otherwise chosen terms will be unique. This is useful in the case of wildcards, e.g.\n    <code class=\"codeblock\">{2$$__artist__}</code> is equivalent to <code class=\"codeblock\">{2$$__artist__|__artist__}</code><br/><br/>\n\n    A range can be provided:\n    <code class=\"codeblock\">{1-3$$artist1|artist2|artist3}</code><br/>\n    In this case, a random number of artists between 1 and 3 is chosen.<br/><br/>\n\n    Wildcards can be used and the joiner can also be specified:\n    <code class=\"codeblock\">{{1-$$and$$__adjective__}}</code><br/>\n\n    Here, a random number between 1 and 3 words from adjective.txt will be chosen and joined together with the word 'and' instead of the default comma.\n\n    <br/><br/>\n\n    <h3><strong>Wildcards</strong></h3>\n    \n\n    <br/>\n    If the groups wont drop down click <strong onclick=\"check_collapsibles()\" style=\"cursor: pointer\">here</strong> to fix the issue.\n\n    <br/><br/>\n\n    <code class=\"codeblock\">WILDCARD_DIR: E:\\AIstuff\\stable-diffusion-webui\\extensions\\sd-dynamic-prompts\\wildcards</code><br/>\n    <small onload=\"check_collapsibles()\">You can add more wildcards by creating a text file with one term per line and name is mywildcards.txt. Place it in E:\\AIstuff\\stable-diffusion-webui\\extensions\\sd-dynamic-prompts\\wildcards. <code class=\"codeblock\">__&#60;folder&#62;/mywildcards__</code> will then become available.</small>\n</div>\n\n",
                    true,
                    false,
                    1,
                    false,
                    false,
                    false,
                    100,
                    0.7,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    0.9,
                    5,
                    "0.0001",
                    false,
                    "None",
                    "",
                    0.1,
                    false,
                    false,
                    false,
                    false,
                    false,
                    "",
                    "Seed",
                    "",
                    "Nothing",
                    "",
                    true,
                    false,
                    false
                ]
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        }

        // TODO: add progress ping

        const res = await fetch('http://127.0.0.1:7860/run/predict/', option).catch((err) => {
            console.log(err)
            interaction.editReply({content: 'Error: ```' + err + '```'})
        })

        if (!res) return

        const res_obj = await res.json()
        if (res_obj.data) {

            console.log(res_obj.duration)
            const result_embeded = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Output')
                .setDescription(`Here you go. Generated in ${res_obj.duration.toFixed(2)} seconds.`)
                .setImage('attachment://img.png')
                .setFooter({text: "Putting my RTX 3060 to good use!"});

            await interaction.editReply({ embeds: [result_embeded], files: [
                { attachment: res_obj.data[0][0].name, name: 'img.png' } ]
            })
        }
        else {
            await interaction.editReply({content: 'Error: ```' + JSON.stringify(res_obj) + '```'})
        }
	},
};