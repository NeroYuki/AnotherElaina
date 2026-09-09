'use strict'

const schemas = {
    message: require('./message.json'),
    scene: require('./scene.json'),
    memory: require('./memory.json'),
    extraction: require('./extraction.json'),
    tool: require('./tool.json')
}

function createSchemaValidator(options = {}) {
    let Ajv = options.Ajv
    if (!Ajv) {
        try {
            Ajv = require('ajv/dist/2020')
        } catch (error) {
            const wrapped = new Error('Ajv is required for chat schema validation; install ajv')
            wrapped.code = 'CHAT_DEPENDENCY_MISSING'
            wrapped.cause = error
            throw wrapped
        }
    }
    Ajv = Ajv.default || Ajv
    const ajv = options.ajv || new Ajv({ allErrors: true, strict: true, formats: false })
    const compiled = new Map()
    return {
        validate(name, value) {
            if (!schemas[name]) throw new Error(`Unknown chat schema: ${name}`)
            if (!compiled.has(name)) compiled.set(name, ajv.compile(schemas[name]))
            const validate = compiled.get(name)
            const valid = validate(value)
            return { valid, errors: valid ? [] : (validate.errors || []).map(error => ({ ...error })) }
        }
    }
}

module.exports = { createSchemaValidator, schemas }
