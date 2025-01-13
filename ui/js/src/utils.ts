/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

/**
 * Returns true when the input is not undefined, null, or an empty string
 * @param thing The thing to check
 */
export function notNullOrEmpty(thing?: any): boolean {
    return !(thing === undefined || thing === null || thing === "")
}
