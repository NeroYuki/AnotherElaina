'use strict';

let ajvInstance;
const compiledSchemas = new WeakMap();

function ajvValidator(schema) {
    if (ajvInstance === undefined) {
        try {
            const Ajv = require('ajv');
            ajvInstance = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
        } catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') throw error;
            ajvInstance = null;
        }
    }
    if (!ajvInstance || !schema || typeof schema !== 'object') return null;
    let validate = compiledSchemas.get(schema);
    if (!validate) {
        validate = ajvInstance.compile(schema);
        compiledSchemas.set(schema, validate);
    }
    return validate;
}

function typeMatches(value, type) {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
}

function validateSchema(schema, value, path = '$') {
    const errors = [];
    if (!schema || schema === true) return errors;
    if (schema === false) return [{ path, message: 'is not allowed' }];

    if (schema.oneOf) {
        const matches = schema.oneOf.map(candidate => validateSchema(candidate, value, path))
            .filter(candidateErrors => candidateErrors.length === 0).length;
        if (matches !== 1) errors.push({ path, message: 'must match exactly one allowed shape' });
    }
    if (schema.anyOf && !schema.anyOf.some(candidate => validateSchema(candidate, value, path).length === 0)) {
        errors.push({ path, message: 'must match an allowed shape' });
        return errors;
    }
    if (schema.const !== undefined && !Object.is(value, schema.const)) {
        errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    }
    if (schema.enum && !schema.enum.some(item => Object.is(item, value))) {
        errors.push({ path, message: 'must be one of the allowed values' });
    }

    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (types.length && !types.some(type => typeMatches(value, type))) {
        errors.push({ path, message: `must be ${types.join(' or ')}` });
        return errors;
    }

    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: 'is too short' });
        if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: 'is too long' });
        if (schema.pattern && !new RegExp(schema.pattern, schema.patternFlags || '').test(value)) errors.push({ path, message: 'has invalid format' });
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
        if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: 'has too few items' });
        if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: 'has too many items' });
        if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, `${path}[${index}]`)));
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const properties = schema.properties || {};
        for (const required of schema.required || []) {
            if (!Object.prototype.hasOwnProperty.call(value, required)) {
                errors.push({ path: `${path}.${required}`, message: 'is required' });
            }
        }
        for (const [key, item] of Object.entries(value)) {
            if (properties[key]) errors.push(...validateSchema(properties[key], item, `${path}.${key}`));
            else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: 'is not allowed' });
            else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                errors.push(...validateSchema(schema.additionalProperties, item, `${path}.${key}`));
            }
        }
    }
    return errors;
}

function assertSchema(schema, value, label = 'value') {
    const validate = ajvValidator(schema);
    const errors = validate
        ? (validate(value) ? [] : validate.errors.map(error => ({
            path: error.instancePath ? `$${error.instancePath.replace(/\//g, '.')}` : '$',
            message: error.message || 'is invalid',
        })))
        : validateSchema(schema, value);
    if (errors.length) {
        const error = new TypeError(`${label} failed schema validation: ${errors.map(item => `${item.path} ${item.message}`).join('; ')}`);
        error.code = 'SCHEMA_VALIDATION_FAILED';
        error.validationErrors = errors;
        throw error;
    }
    return value;
}

module.exports = { validateSchema, assertSchema, ajvValidator };
