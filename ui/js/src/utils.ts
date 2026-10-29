/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

/**
 * A container to allow a variable to be readonly but still updated at runtime. This
 * works around a goofy bug in AngularJS where top-level variables are sometimes
 * not updated.
 */
export class Container<T> {
    value: T | null;

    constructor(value: T | null = null) {
        this.value = value;
    }
}

export function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    return function(this: any, ...args: any[]) {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    } as T;
}

export function getOrDefault<T>(object: object | null, field: string, defaultValue: T): T {
    if (object === undefined || object === null) {
        return defaultValue
    }
    if (field in object) {
        return object[field] || defaultValue
    }
    return defaultValue
}

export function isString(value: any): value is string | String {
    return typeof value === 'string' || value instanceof String;
}

export function nullOrEmpty(thing?: any): boolean {
    return (thing === undefined || thing === null || thing === "")
}

/**
 * Returns true when the input is not undefined, null, or an empty string
 * @param thing The thing to check
 */
export function notNullOrEmpty(thing?: any): boolean {
    return !(thing === undefined || thing === null || thing === "")
}
