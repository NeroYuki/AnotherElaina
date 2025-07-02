const { SlashCommandBuilder } = require('@discordjs/builders');
const ComfyClient = require('../utils/comfy_client');
const workflow_vid_post_process = require('../resources/video_post_process.json');
const { loadImage } = require('../utils/load_discord_img');
const { catboxFileUploadBuffer } = require('../utils/catbox_upload');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('wd_vid_upscale')
            .setDescription('Post Process a video')
            .addAttachmentOption(option =>
                option.setName('video')
                    .setDescription('The video to be post processed')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('color_correction')
                    .setDescription('Select the color correction model to use')
                    .addChoices(
                        { name: 'None', value: 'None' },
                        { name: 'mkl', value: 'mkl' },
                        { name: 'hm', value: 'hm' },
                        { name: 'reinhard', value: 'reinhard' },
                        { name: 'mvgd', value: 'mvgd' },
                        { name: 'hm-mvgd-hm', value: 'hm-mvgd-hm' },
                        { name: 'hm-mkl-hm', value: 'hm-mkl-hm' },
                    ))
            .addNumberOption(option =>
                option.setName('color_correction_strength')
                    .setDescription('The strength of the color correction model (default is 1.0)')
                    .setMinValue(0.0)
                    .setMaxValue(10.0)
                    .setRequired(false))
            .addAttachmentOption(option =>
                option.setName('ref_image')
                    .setDescription('The reference image to use for color correction'))
            .addStringOption(option =>
                option.setName('upscaler')
                    .setDescription('Select the upscaler to use')
                    .addChoices(
                        { name: 'None', value: 'None' },
                        { name: 'AnimeSharp v3 2x', value: '2x-AnimeSharpV3.pth' },
                        { name: 'AnimeSharp v4 2x', value: '2x-AnimeSharpV4_RCAN.safetensors' },
                        { name: 'AnimeSharp 4x', value: '4x_AnimeSharp.pth' },
                        { name: 'NMKD Siax 4x', value: '4x_NMKD-Siax_200k.pth' },
                        { name: 'UltraSharp 4x', value: '4x_UltraSharp.pth' },
                        { name: 'ERSGAN 4x', value: 'ESRGAN_4x.pth' },
                    ))
            .addStringOption(option =>
                option.setName('frame_interpolation')
                    .setDescription('Select the frame interpolation model to use')
                    .addChoices(
                        { name: 'None', value: 'None' },
                        { name: 'RIFE47', value: 'rife47.pth' },
                        { name: 'RIFE49', value: 'rife49.pth' },
                    ))

    ,

	async execute(interaction, client) {
        await interaction.deferReply();

        const workflow = JSON.parse(JSON.stringify(workflow_vid_post_process))

        const attachment_option = interaction.options.getAttachment('video');
        const color_correction = interaction.options.getString('color_correction') || 'None';
        const color_correction_strength = interaction.options.getNumber('color_correction_strength') || 1.0;
        const ref_image_option = interaction.options.getAttachment('ref_image');
        const upscaler = interaction.options.getString('upscaler') || 'None';
        const frame_interpolation = interaction.options.getString('frame_interpolation') || 'None';

        if (color_correction === 'None' && upscaler === 'None' && frame_interpolation === 'None') {
            interaction.editReply({ content: "No post processing options selected, nothing to do." });
            return;
        }

        //make a temporary reply to not get timeout'd
        await interaction.editReply({ content: "Processing video upscale..." });

        //download the image from attachment.proxyURL
        let attachment = await loadImage(attachment_option.proxyURL,
            /*getBuffer:*/ true).catch((err) => {
            console.log("Failed to retrieve video from discord", err)
            return
        })

        //set the image buffer to the workflow
        const video_info = await ComfyClient.uploadImage(attachment, Date.now() + "_" + attachment_option.name, attachment_option.contentType).catch((err) => {
            console.log("Failed to upload video", err)
            return
        })

        if (video_info == null) {
            interaction.editReply({ content: "Failed to receive input video" });
            return
        }

        let ref_image_attachment = null;
        let ref_image_info = null;
        if (ref_image_option) {
            ref_image_attachment = await loadImage(ref_image_option.proxyURL,
                /*getBuffer:*/ true).catch((err) => {
                console.log("Failed to retrieve reference image from discord", err)
                return
            })

            //set the image buffer to the workflow
            ref_image_info = await ComfyClient.uploadImage(ref_image_attachment, Date.now() + "_" + ref_image_option.name, ref_image_option.contentType).catch((err) => {
                console.log("Failed to upload reference image", err)
                return
            })

            if (ref_image_info == null) {
                interaction.editReply({ content: "Failed to receive reference image" });
                return;
            }
        }

        const input_video_node = "1"
        const color_matching_node = "2"
        const input_ref_image_node = "3"
        const output_video_node = "4"
        const upscale_model_node = "5"
        const upscale_node = "6"
        const frame_interpolation_node = "7";
        const fps_multiplier_node = "9";

        workflow[input_video_node]["inputs"]["video"] = video_info.name;

        let images_location = [input_video_node, 0]

        if (color_correction === 'None') {
            delete workflow[color_matching_node];
            delete workflow[input_ref_image_node];

        }
        else {
            if (!ref_image_info) {
                interaction.editReply({ content: "Reference image is required for color correction." });
                return;
            }

            images_location = [color_matching_node, 0];
            workflow[color_matching_node]["inputs"]["method"] = color_correction;
            workflow[color_matching_node]["inputs"]["strength"] = color_correction_strength;
        }

        // change the input of upscale node to input video node, assign value, not reference
        workflow[upscale_node]["inputs"]["image"] = images_location.slice(0);  

        if (upscaler === 'None') {
            delete workflow[upscale_model_node];
            delete workflow[upscale_node];
        }
        else {
            images_location = [upscale_node, 0];
            workflow[upscale_model_node]["inputs"]["model_name"] = "forge\\" + upscaler;
        }

        workflow[frame_interpolation_node]["inputs"]["frames"] = images_location.slice(0);  

        if (frame_interpolation === 'None') {
            delete workflow[frame_interpolation_node];
            workflow[fps_multiplier_node]["inputs"]["value"] = 1
        }
        else {
            images_location = [frame_interpolation_node, 0];
            workflow[frame_interpolation_node]["inputs"]["model_name"] = frame_interpolation
        }

        workflow[output_video_node]["inputs"]["images"] = images_location.slice(0);  

        ComfyClient.sendPrompt(workflow, (data) => {
            if (data.node !== null) interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] });
        }, async (data) => {
            console.log('received success')
            const filename = data.output.gifs[0].filename

            // fetch video from comfyUI
            ComfyClient.getImage(filename, '', '', /*only_filename*/ true).then(async (arraybuffer) => {
                // convert arraybuffer to buffer
                const buffer = Buffer.from(arraybuffer)

                // check buffer size (if bigger than 10 MB, upload to catbox)
                if (buffer.length > 9_800_000) {
                    const catbox_url = await catboxFileUploadBuffer(buffer, filename);
                    if (catbox_url) {
                        await interaction.editReply({ content: "Generation Success, uploaded to Catbox", files: [{ attachment: catbox_url, name: filename }] });
                        return;
                    }
                }
                else {
                    await interaction.editReply({ content: "Generation Success", files: [{ attachment: buffer, name: filename }] });
                }
            }).catch((err) => {
                console.log("Failed to retrieve video", err)
                interaction.editReply({ content: "Failed to retrieve video" });
            }).finally(() => {
                ComfyClient.freeMemory(true)
            })

        }, (data) => {
            console.log('received error')
            interaction.editReply({ content: data.error });
            ComfyClient.freeMemory(true)
        }, (data) => {
            console.log('received progress')

            // skip video combine node update progress (too spammy)
            if (workflow[data.node]["_meta"]["title"].includes("🎥🅥🅗🅢")) return

            interaction.editReply({ content: "Processing: " + workflow[data.node]["_meta"]["title"] + ` (${data.value}/${data.max})` });
        });
	},
};