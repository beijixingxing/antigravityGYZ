
// Logic ported from gcli2api/src/openai_transfer.py

const DEFAULT_SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

export function mergeSafetySettings(userSettings: any[] = []): any[] {
    const existingCategories = new Set(userSettings.map((s: any) => s.category));
    const merged = [...userSettings];
    
    for (const defaultSetting of DEFAULT_SAFETY_SETTINGS) {
        if (!existingCategories.has(defaultSetting.category)) {
            merged.push(defaultSetting);
        }
    }
    return merged;
}

export function normalizeFunctionName(name: string): string {
    if (!name) return "_unnamed_function";

    // 1. Replace invalid chars with underscore (Keep a-z, A-Z, 0-9, _, ., -)
    let normalized = name.replace(/[^a-zA-Z0-9_.\-]/g, "_");

    // 2. Handle start char (must be letter or underscore)
    if (normalized.length > 0 && !/^[a-zA-Z_]/.test(normalized)) {
        if (/^[.\-]/.test(normalized)) {
            normalized = "_" + normalized.substring(1);
        } else {
            normalized = "_" + normalized;
        }
    }

    // 3. Merge consecutive underscores
    normalized = normalized.replace(/_+/g, "_");

    // 4. Trim start/end underscores (if not starting with _)
    // The original python logic logic: if name started with _, keep it.
    // If we added a prefix, keep it.
    // Logic: `if name.startswith("_") or prefix_added` -> keep leading.
    // Simplify: just trim trailing
    normalized = normalized.replace(/_$/, "");

    if (!normalized) return "_unnamed_function";
    return normalized.substring(0, 64);
}

export function cleanSchemaForGemini(schema: any): any {
    if (typeof schema !== 'object' || schema === null) return schema;

    const unsupportedKeys = new Set([
        '$schema', '$id', '$ref', '$defs', 'definitions',
        'title', 'example', 'examples', 'readOnly', 'writeOnly',
        'default',
        'exclusiveMaximum', 'exclusiveMinimum',
        'oneOf', 'anyOf', 'allOf', 'const',
        'additionalItems', 'contains', 'patternProperties',
        'dependencies', 'propertyNames', 'if', 'then', 'else',
        'contentEncoding', 'contentMediaType',
    ]);

    const cleaned: any = Array.isArray(schema) ? [] : {};

    for (const key in schema) {
        if (unsupportedKeys.has(key)) continue;

        const value = schema[key];
        if (typeof value === 'object' && value !== null) {
            cleaned[key] = cleanSchemaForGemini(value);
        } else {
            cleaned[key] = value;
        }
    }

    // Ensure 'type' exists if 'properties' exists
    if (!Array.isArray(cleaned) && cleaned.properties && !cleaned.type) {
        cleaned.type = 'object';
    }

    return cleaned;
}

export function transformTools(openaiTools: any[]): any[] {
    if (!openaiTools || openaiTools.length === 0) return [];

    const functionDeclarations = openaiTools
        .filter((t: any) => t.type === 'function')
        .map((t: any) => {
            const fd: any = {
                name: normalizeFunctionName(t.function.name),
                description: t.function.description
            };
            if (t.function.parameters) {
                fd.parameters = cleanSchemaForGemini(t.function.parameters);
            }
            return fd;
        });

    if (functionDeclarations.length > 0) {
        return [{ functionDeclarations }];
    }
    return [];
}
