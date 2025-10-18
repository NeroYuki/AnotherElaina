const { SlashCommandBuilder } = require('@discordjs/builders');
const { queryRecordLimit } = require('../../database/database_interaction');
const { MessageEmbed, MessageAttachment } = require('discord.js');
const { truncate } = require('../../utils/common_helper');
const { server_pool, get_worker_server } = require('../../utils/ai_server_config');
const crypt = require('crypto');
const { default: axios } = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_profile_detail')
		.setDescription('Return the detail of a specified AI image creation profile')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the profile to return')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to return the profile of (Default to yourself)'))
        .addBooleanOption(option =>
            option.setName('server_wildcard')
                .setDescription('Search for wildcard profile on the server, instead of user\'s profile')
                .setRequired(false))
    ,

	async execute(interaction) {
		// parse the option
        const name = interaction.options.getString('name');
        let user = interaction.options.getUser('user') || interaction.user;
        const server_wildcard = interaction.options.getBoolean('server_wildcard') || false;

        await interaction.deferReply();

        let attachment = null;
        let embeded = new MessageEmbed()
            .setColor('#8888ff')
            .setTitle('Profile Info')

        if (server_wildcard) {
            let server_index = get_worker_server(-1)

            if (server_index === -1) {
                await interaction.editReply({ content: "No server is available, please try again later"});
                return
            }

            // TODO: add progress ping
            const session_hash = crypt.randomBytes(16).toString('base64');

            const WORKER_ENDPOINT = server_pool[server_index].url
        
            // sanitize the name
            const sanitized_name = name.replace(/[^a-zA-Z0-9_\- ]/g, '_');
            const fetch_list = [
                "{\n  \"action\": \"load file\",\n  \"name\": \"" + sanitized_name + "\"}"
            ]

            const fn_index_fetch = server_pool[server_index].fn_fetch_wildcards

            // make option_init but for axios
            const option_init_axios = {
                data: {
                    fn_index: fn_index_fetch,
                    session_hash: session_hash,
                    data: fetch_list,
                },
                config: {
                    timeout: 900000
                }
            }

            try {
                await axios.post(`${WORKER_ENDPOINT}/run/predict/`, option_init_axios.data, option_init_axios.config )
                    .then((res) => {
                        if (res.status !== 200) {
                            throw 'Server can be reached but returned non-200 status'
                        }
                        return res.data
                    }) // fuck node fetch, all my homies use axios
                    .then(async (final_res_obj) => {
                        const data = JSON.parse(final_res_obj.data[0].value)
                        if (data.contents) {
                            const prompt = `${data.contents || ''}`
                            const is_too_big = prompt.length > 4000
                            if (is_too_big) {
                                attachment = new MessageAttachment(Buffer.from(prompt, 'utf-8'), 'prompt.txt');
                            }
                            // directly send the embeded here
                            embeded.setDescription(`**Prompt:** ${is_too_big ? '<Too long to display, see attachment>' : prompt}`);
                            embeded.setFooter({text: "Profile Owner: AI Server", iconURL: "https://cdn.discordapp.com/embed/avatars/0.png"});

                            const reply_content = { embeds: [embeded] };
                            if (attachment) {
                                reply_content.files = [attachment];
                            }
                            
                            await interaction.editReply(reply_content);
                        }
                        else {
                            await interaction.editReply({content: `:x: Profile with name ${name} does not exist on the server`});
                        }
                    })
                    .catch(err => {
                        throw err
                    });
            }
            catch (err) {
                console.log(err)
                try {
                    await interaction.editReply({content: 'Error while fetching wildcard '})
                }
                catch (err) {
                    console.log('cannot send error to discord', err)
                }
            }

            return 
        }

        // query the database
        let result = await queryRecordLimit('wd_profile', { name: name, user_id: user.id }, 1);

        // check if the profile exists
        if (result.length == 0) {
            await interaction.channel.send(`:warning: You don't have profile with name ${name}, searching from all users...`);
            result = await queryRecordLimit('wd_profile', { name: name }, 1);

            if (result.length == 0) {
                await interaction.editReply(`:x: Profile with name ${name} does not exist`);
                return;
            }
        }

        // compose the reply (only display non-default values)
        const data = result[0];

        if (user.id != result[0].user_id) {
            // fetch user info
            user = await interaction.client.users.fetch(result[0].user_id).catch(() => null);
        }

        if (user) {
            embeded.setFooter({text: "Profile Owner: " + user.username, iconURL: user.avatarURL({dynamic: true}) || "https://cdn.discordapp.com/embed/avatars/0.png"});
        }

        // if data.prompt is longer than 4000 characters, make it into an attachment .txt file and send it\
        if (data.prompt != '' || data.prompt_pre != '') {
            const prompt = `${data.prompt_pre || ''} ... ${data.prompt || ''}`
            const is_too_big = prompt.length > 4000
            if (is_too_big) {
                attachment = new MessageAttachment(Buffer.from(prompt, 'utf-8'), 'prompt.txt');
            }

            embeded.setDescription(`**Prompt:** ${is_too_big ? '<Too long to display, see attachment>' : prompt}`);
        }

        if (data.neg_prompt != '' || data.neg_prompt_pre != '') {
            embeded.addFields({ name: 'Negative Prompt', value: `${data.neg_prompt_pre || ''} ... ${data.neg_prompt || ''}` })
        }
        if (data.seed && data.seed != '-1') {
            embeded.addFields({ name: 'Seed', value: data.seed });
        }
        if (data.width && data.width != 512) {
            embeded.addFields({ name: 'Width', value: data.width.toString() });
        }
        if (data.height && data.height != 512) {
            embeded.addFields({ name: 'Height', value: data.height.toString() });
        }
        if (data.sampler && data.sampler != 'Euler a') {
            embeded.addFields({ name: 'Sampler', value: data.sampler });
        }
        if (data.scheduler && data.scheduler != 'Automatic') {
            embeded.addFields({ name: 'Scheduler', value: data.scheduler });
        }
        if (data.cfg_scale && data.cfg_scale != 7) {
            embeded.addFields({ name: 'CFG Scale', value: data.cfg_scale.toString() });
        }
        if (data.sampling_step && data.sampling_step != 20) {
            embeded.addFields({ name: 'Sampling Step', value: data.sampling_step.toString() });
        }
        if (data.upscale_multiplier && data.upscale_multiplier != 1) {
            embeded.addFields({ name: 'Upscale Multiplier', value: data.upscale_multiplier.toString() });
        }
        if (data.upscaler && data.upscaler != 'Lanczos') {
            embeded.addFields({ name: 'Upscaler', value: data.upscaler });
        }
        if (data.upscale_denoise_strength && data.upscale_denoise_strength != 0.7) {
            embeded.addFields({ name: 'Upscale Denoise Strength', value: data.upscale_denoise_strength.toString() });
        }
        if (data.upscale_step && data.upscale_step != 20) {
            embeded.addFields({ name: 'Upscale Step', value: data.upscale_step.toString() });
        }
        if (data.clip_skip && data.clip_skip != 1) {
            embeded.addFields({ name: 'CLIP skip', value: data.clip_skip.toString() });
        }
        if (data.checkpoint) {
            embeded.addFields({ name: 'Checkpoint', value: data.checkpoint });
        }
        if (data.adetailer_config) {
            try {
                const adetailer_config_obj = JSON.parse(data.adetailer_config);
                // TODO: validate the adetailer_config_obj
                embeded.addFields({ name: 'ADetailer Config', value: "\`\`\`json\n" + truncate(JSON.stringify(adetailer_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'ADetailer Config', value: 'Failed to parse config' });
            }
        }
        if (data.controlnet_config) {
            try {
                const controlnet_config_obj = JSON.parse(data.controlnet_config);
                // TODO: validate the controlnet_config_obj
                embeded.addFields({ name: 'Controlnet Config', value: "\`\`\`json\n" + truncate(JSON.stringify(controlnet_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Controlnet Config', value: 'Failed to parse config' });
            }
        }
        if (data.colorbalance_config) {
            try {
                const colorbalance_config_obj = JSON.parse(data.colorbalance_config);
                // TODO: validate the colorbalance_config_obj
                embeded.addFields({ name: 'Colorbalance Config', value: "\`\`\`json\n" + truncate(JSON.stringify(colorbalance_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Colorbalance Config', value: 'Failed to parse config' });
            }
        }
        if (data.boorugen_config) {
            try {
                const boorugen_config_obj = JSON.parse(data.boorugen_config);

                embeded.addFields({ name: 'Boorugen Config', value: "\`\`\`json\n" + truncate(JSON.stringify(boorugen_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Boorugen Config', value: 'Failed to parse config' });
            }
        }
        if (data.script_outpaint_config) {
            try {
                const script_outpaint_config_obj = JSON.parse(data.script_outpaint_config);
                // TODO: validate the script_outpaint_config_obj
                embeded.addFields({ name: 'Script Outpaint Config', value: "\`\`\`json\n" + truncate(JSON.stringify(script_outpaint_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Script Outpaint Config', value: 'Failed to parse config' });
            }
        }
        if (data.script_upscale_config) {
            try {
                const script_upscale_config_obj = JSON.parse(data.script_upscale_config);
                // TODO: validate the script_upscale_config_obj
                embeded.addFields({ name: 'Script Upscale Config', value: "\`\`\`json\n" + truncate(JSON.stringify(script_upscale_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Script Upscale Config', value: 'Failed to parse config' });
            }
        }
        if (data.latentmod_config) {
            try {
                const latentmod_config_obj = JSON.parse(data.latentmod_config);

                embeded.addFields({ name: 'Latentmod Config', value: "\`\`\`json\n" + truncate(JSON.stringify(latentmod_config_obj, null, 2), 998) + "\`\`\`" });
            }
            catch (err) {
                embeded.addFields({ name: 'Latentmod Config', value: 'Failed to parse config' });
            }
        }

        const reply_content = { embeds: [embeded] };
        if (attachment) {
            reply_content.files = [attachment];
        }
        
        await interaction.editReply(reply_content);
	},
};