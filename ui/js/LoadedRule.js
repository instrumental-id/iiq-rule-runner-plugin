
/**
 * @param id
 * @param name
 * @param type
 * @param libraries
 * @param originalSource
 * @param description
 * @param variables
 * @constructor
 */
function LoadedRule(id, name, type, libraries, originalSource, description, variables) {

    /**
     * @type {string|null}
     */
    this.id = id

    /**
     * @type {string}
     */
    this.name = name

    /**
     * @type {string}
     */
    this.type = type || ""

    /**
     * @type {Array<string>}
     */
    this.libraries = libraries || []

    /**
     * @type {string}
     */
    this.originalSource = originalSource

    /**
     * @type {string|null}
     */
    this.description = description

    /**
     * @type {Variable[]|null}
     */
    this.variables = variables
}

/**
 * Returns true if this Rule has been persisted to the database, false if it is
 * ephemeral on the client side.
 *
 * @return {boolean}
 */
LoadedRule.prototype.isPersisted = function() {
    return (id != null && id.length > 0)
}

/**
 * @return {SelectizeLibrary[]}
 */
LoadedRule.prototype.getSelectizeLibraries = function() {
    let selectizeLibraries = []
    if (this.libraries) {
        for (let library of this.libraries) {
            selectizeLibraries.push({title: library})
        }
    }
    return selectizeLibraries
}
