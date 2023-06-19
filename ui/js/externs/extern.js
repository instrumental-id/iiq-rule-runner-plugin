/**
 * @extern
 */

var Ext = {};

Ext.Date = {};

/**
 * @param {Date} date
 * @param {string} str
 * @return {string} The formatted date
 */
Ext.Date.format = function(date, str) {

}

/**
 * @typedef PluginHelper
 * @property {function(string): string} getPluginRestUrl Gets the URL relative to the IIQ base
 * @property {function(string, string): string} getPluginFileUrl
 */

/**
 * @typedef AngularScope
 * @property {function(!string, function(any, any))} $watch
 * @property {Openable} resultselem
 * @property {Openable} documentationelem
 * @property {Openable} historyelem
 * @property {?RunningRule} lastUpdateObject
 * @property {?Date} lastUpdate
 * @property {?string} errorMessage
 * @property {?object} json
 * @property {?string} xml
 * @property {?string} output
 * @property {?string} outputType
 * @property {?LogMessage[]} logs
 * @property {any} stats
 */

/**
 * @typedef Openable
 * @property {boolean} open
 */

/**
 * @typedef ParseError
 * @property {string} message
 * @property {number} line
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef SelectizeLibrary
 * @property {string} title
 */

/**
 * @typedef HistoryEntry
 * @property {number} timestamp
 * @property {string} date
 * @property {SelectizeLibrary[]} libraries
 * @property {!string} source
 * @property {LoadedRule|null} loadedRule
 * @property {boolean} isWorkflowRuleLibrary
 * @property {boolean} suppressRawTypeErrors
 * @property {boolean} includeWebClasses
 */

/**
 * @typedef Variable
 * @property {!string} name
 * @property {string} type
 */
