/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {Variable} from "../types";
import {getOrDefault} from "../utils";

/**
 * Checks the validity of the variable name and returns either an error message
 * if it's invalid or null if it is valid
 * @param name The name of the variable to check
 * @return {string|null}
 */
function rrCheckVariableName(name: string): string | null {
    const reservedNames = [
        "log", "context", "monitor", "_log", "uuid", "httpRequest", "httpResponse", "webService", "monitor", "__worker", "void", "if", "do", "while", "for", "switch", "global", "this", "super"
    ]
    if (name === undefined || name === null || name === "") {
        return "Name is not optional"
    }

    let variableRegex = new RegExp('^[A-Za-z$_][A-Za-z0-9$_]*$');
    if (!variableRegex.test(name)) {
        return "Name is not a valid alphanumeric Beanshell variable name"
    }

    if (reservedNames.includes(name)) {
        return "Name is not available for use"
    }

    return null;
}

/**
 * Returns true if the string is undefined, null, or only whitespace
 */
function rrIsEmpty(string: string | null): boolean {
    return (string === undefined || string === null || string.trim().length === 0)
}

export type RuleValueType = "value" | "script" | "object" | ""

/**
 * @param {object|null} options
 * @constructor
 */
export class RuleValue {
    index: number;

    valueType: string;

    objectValue: string;

    objectScript: string;

    objectName: string;

    constructor(options = {}) {
        /**
         * @type {number}
         */
        this.index = getOrDefault(options, "index", -1);

        /**
         * @type {string}
         */
        this.valueType = getOrDefault(options, "valueType", "")

        /**
         * @type {string}
         */
        this.objectValue = getOrDefault(options, "objectValue", "");

        /**
         * @type {string}
         */
        this.objectScript = getOrDefault(options, "objectScript", "");

        /**
         * @type {string}
         */
        this.objectName = getOrDefault(options, "objectName", "");
    }

    getValueType(): RuleValueType {
        if (this.valueType === "value" && !rrIsEmpty(this.objectValue)) {
            return "value"
        } else if (this.valueType === "script" && !rrIsEmpty(this.objectScript)) {
            return "script"
        } else if (this.valueType === "object" && !rrIsEmpty(this.objectName)) {
            return "object"
        } else {
            return ""
        }
    }
}

/**
 * @param {object|null} options
 * @constructor
 */
export class RuleVariable implements Variable {
    provided: boolean;
    name: string;
    type: string;
    description: string;
    value: RuleValue;

    constructor(options = {}) {
        this.provided = getOrDefault(options, "provided", false)

        this.name = getOrDefault(options, "name", "");

        this.type = getOrDefault(options, "type", "java.lang.String");

        this.description = getOrDefault(options, "description", "")

        this.value = new RuleValue(getOrDefault(options, "value", {}));
    }

    /**
     * Used by AngularJS to decide whether to show the error message for this variable
     * @return {boolean}
     */
    isValid(): boolean {
        return (this.getValidationText() === null)
    }

    /**
     * @return {string|null}
     */
    getValidationText(): string | null {
        return rrCheckVariableName(this.name)
    }

    getInitializerType(): RuleValueType {
        if (this.value == null) {
            return ""
        } else {
            return this.value.getValueType()
        }
    }

    /**
     * Returns true if this variable's type is a Sailpoint object
     * @return {boolean} True if the object is a Sailpoint type
     */
    isSailpointType(): boolean {
        return this.type !== undefined && this.type.indexOf("sailpoint.object") === 0
    }

}