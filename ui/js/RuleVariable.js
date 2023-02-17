/**
 * Checks the validity of the variable name and returns either an error message
 * if it's invalid or null if it is valid
 * @param name The name of the variable to check
 * @return {string|null}
 */
function rrCheckVariableName(name) {
    const reservedNames = [
        "log", "context", "monitor", "_log", "uuid", "httpRequest", "httpResponse", "webService", "void", "if", "do", "while", "for", "switch", "global", "this", "super"
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
 *
 *
 * @template T
 *
 * @param {object|null} object
 * @param {string} field
 * @param {T} defaultValue
 * @return {T} The value or the default
 */
function getOrDefault(object, field, defaultValue) {
    if (object === undefined || object === null) {
        return defaultValue
    }
    if (field in object) {
        return object[field] || defaultValue
    }
    return defaultValue
}

/**
 * @param {string|null} string
 * @return {boolean}
 */
function rrIsEmpty(string) {
    return (string === undefined || string === null || string.trim().length === 0)
}

/**
 * @param {object|null} options
 * @constructor
 */
function RuleValue(options = {}) {
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

RuleValue.prototype.getValueType = function() {
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

/**
 * @param {object|null} options
 * @constructor
 */
function RuleVariable(options = {}) {
    this.provided = getOrDefault(options, "provided", false)

    this.name = getOrDefault(options, "name", "");

    this.type = getOrDefault(options, "type", "");

    this.description = getOrDefault(options, "description", "")

    this.value = new RuleValue(getOrDefault(options, "value", {}));
}

/**
 * @return {boolean}
 */
RuleVariable.prototype.isValid = function() {
    return (this.getValidationText() === null)
}

/**
 * @return {string|null}
 */
RuleVariable.prototype.getValidationText = function() {
    return rrCheckVariableName(this.name)
}

RuleVariable.prototype.getInitializerType = function() {
    if (this.value == null) {
        return ""
    } else {
        return this.value.getValueType()
    }
}

/**
 * Returns true if this variable's type is a Sailpoint object
 * @return {boolean}
 */
RuleVariable.prototype.isSailpointType = function() {
    return this.type !== undefined && this.type.indexOf("sailpoint.object") === 0
}