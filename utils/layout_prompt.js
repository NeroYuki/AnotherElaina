'use strict';

const {
    compileLayoutPrompt,
    extractLayoutToken,
    layoutToCouplerPrompt,
    resolveModelFamily,
    resolveLayoutMode,
    scaleLayoutDraft,
} = require('./moss_layout');
const { getLayout } = require('./layout_store');
const { draftImageLayout } = require('./layout_agent');

/**
 * Resolve a saved <layout:name> token or ask Qwen to draft a layout, then
 * produce the prompt string the normal generation pipeline should use.
 *
 * Returns null when layout planning is off or unsupported for this model, in
 * which case the caller keeps using plain prompt enrichment.
 */
async function prepareLayoutPrompt({
    prompt, model, width, height, userId, setting = 'off', onProgress = () => {},
    layoutFile, ...agentOverrides
}, deps = {}) {
    const agentDeps = { ...deps, ...agentOverrides, layoutFile: layoutFile || deps.layoutFile };
    const token = extractLayoutToken(prompt);
    if (token) {
        if (!userId) throw new Error('A user id is required to use a saved layout.');
        const saved = await getLayout({ userId, name: token.name, filePath: agentDeps.layoutFile });
        if (!saved) {
            throw new Error(`Layout "${token.name}" was not found. Create it with /wd_layout_draft first.`);
        }
        const scaled = scaleLayoutDraft(saved.draft, width, height);
        const family = resolveModelFamily(model);
        const mode = family === 'moss' ? 'moss' : resolveLayoutMode('coupler', model);
        if (mode === 'off') {
            throw new Error('Saved layout tokens are supported by MOSS and Forge Coupler (SD/SDXL) models.');
        }
        const layoutPrompt = mode === 'moss'
            ? compileLayoutPrompt(scaled, { extra: token.prompt })
            : layoutToCouplerPrompt(scaled, { extra: token.prompt });
        return {
            prompt: layoutPrompt,
            layout: scaled,
            mode,
            source: 'saved',
            name: token.name,
        };
    }

    const mode = resolveLayoutMode(setting, model);
    if (mode === 'off') return null;

    const draft = await draftImageLayout({ prompt, model, width, height, onProgress }, agentDeps);
    const layoutPrompt = mode === 'moss'
        ? compileLayoutPrompt(draft, { extra: prompt })
        : layoutToCouplerPrompt(draft, { extra: prompt });
    return {
        prompt: layoutPrompt,
        layout: draft,
        mode,
        source: 'drafted',
        name: null,
    };
}

module.exports = {
    prepareLayoutPrompt,
    resolveLayoutMode,
    extractLayoutToken,
};
