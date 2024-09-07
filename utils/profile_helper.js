const { queryRecordLimit } = require("../database/database_interaction");

function load_profile(profile_option, user_id) {
    return new Promise(async (resolve, reject) => {
        let profile_data = null
        // attempt to query the profile name on the database
        profile_data = await queryRecordLimit('wd_profile', { name: profile_option, user_id: user_id }, 1)
        if (profile_data.length == 0) {
            // attempt to query global profile
            profile_data = await queryRecordLimit('wd_profile', { name: profile_option }, 1)
            if (profile_data.length == 0) {
                // no profile found
                reject(`Profile ${profile_option} not found, fallback to default setting`);
            }
        }

        if (profile_data.length != 0) {
            let profile = profile_data[0]
            // backward compat to old profile, if sampler name end with 'Karras', 'SGM Uniform', 'Exponential', split the sampler name into sampler and scheduler
            const schedulers = [
                { name: 'Karras', suffix: ' Karras' },
                { name: 'SGM Uniform', suffix: ' SGM Uniform' },
                { name: 'Exponential', suffix: ' Exponential' }
            ];

            for (const scheduler of schedulers) {
                if (profile.sampler.endsWith(scheduler.suffix)) {
                    const scheduler_name = scheduler.name;
                    profile.sampler = profile.sampler.replace(scheduler.suffix, '');
                    profile.scheduler = scheduler_name;
                    break;
                }
            }

            // backward compat to old profile, if checkpoint is not null, remove the hash from the name (encased in square bracket)
            if (profile.checkpoint != null) {
                profile.checkpoint = profile.checkpoint.replace(/\[.*\]/, '').trim();
            }

            resolve(profile)
        }
    });
}

module.exports = {
    load_profile
}