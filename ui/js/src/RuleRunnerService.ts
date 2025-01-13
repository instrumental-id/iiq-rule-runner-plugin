/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {IHttpService, IPromise} from "angular";
import {LoadedRule} from "./LoadedRule.js";
import {IPluginHelper} from "./IIQModule.js";
import {ParseError, SelectizeLibrary, Variable} from "./types.js";
import {LOG_DEBUG} from "./app.js";

import {IAngularStatic} from "angular";
import {ruleRunnerModule} from "./init.js";
declare var angular: IAngularStatic;

declare var PluginHelper: IPluginHelper;

export type RuleNameType = {[key: string]: string}

export interface StoredHistoryItem {
    includeWebClasses: boolean;
    libraries: string[];
    source: string;
    timestamp: number;
}

export class RuleRunnerService {
    /**
     * @param $http
     * @constructor
     */
    constructor(private $http: IHttpService) {
        this.$http = $http
    }

    /**
     * Gets the list of names and types of existing rules
     *
     * @return {Promise<{[string]: {string}}>}
     */
    getRulesList(search: string): IPromise<RuleNameType> {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/list');
        return this.$http.get(PAGE_CONFIG_URL, {params: {search: search}}).then(function(response) {
            return response.data as RuleNameType;
        });
    }

    /**
     * @return {Promise<string[]>}
     */
    getRuleTypes(): IPromise<string[]> {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/types');
        return this.$http.get(PAGE_CONFIG_URL).then(function(response) {
            return response.data as string[];
        });
    }

    /**
     * Gets the type variables for the given type name
     * @param type {string} The type name
     * @return {Promise<{[string]: string}>}
     */
    getTypeVariables(type: string): IPromise<RuleNameType> {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/signature/' + type);
        return this.$http.get(PAGE_CONFIG_URL).then(function(response) {
            return response.data as RuleNameType;
        });
    }

    /**
     * Loads the given rule information
     * @return Promise<LoadedRule>
     */
    loadRule(name: string): IPromise<Partial<LoadedRule> | string> {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/load');
        return this.$http.get(PAGE_CONFIG_URL, {params: {name: name}}).then(function(response) {
            return response.data as Partial<LoadedRule> | string;
        });
    }

    /**
     * Saves the given rule with the given information
     * @returns Promise<LoadedRule>
     */
    saveRule(id, name, source, type, libraries) {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/save');
        return this.$http.post(PAGE_CONFIG_URL, {id: id, name: name, source: source, type: type, libraries: libraries}).then(function(response) {
            return response.data;
        });
    }

    /**
     * Gets the list of all rule libraries (i.e. rules without a type)
     * @return {Promise<string[]>} A list of rule libraries
     */
    getRuleLibraries() {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/rl');
        return this.$http.get(PAGE_CONFIG_URL).then(function(response) {
            return response.data;
        });
    }

    /**
     * Executes the given source code with the given rule libraries and returns the result
     * @param {!string} ruleText
     * @param librariesList
     * @param {boolean} includeWebClasses
     * @param {boolean} isWorkflowRuleLibrary
     * @param {boolean} suppressRawTypeErrors
     * @param variables
     * @return Promise<ParseError[]> Error output
     */
    parseRule(ruleText: string, librariesList: SelectizeLibrary[], includeWebClasses: boolean, isWorkflowRuleLibrary: boolean, suppressRawTypeErrors: boolean, variables: Variable[]): IPromise<ParseError[]> {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/parse');
        // TODO: Handle error output here
        return this.$http.post(PAGE_CONFIG_URL, {script: ruleText, libraries: librariesList, variables: variables, includeWebClasses: includeWebClasses, isWorkflowRuleLibrary: isWorkflowRuleLibrary, suppressRawTypeErrors: suppressRawTypeErrors}).then(function(response) {
            //console.log(response.data)
            return response.data as ParseError[];
        });
    }

    /**
     * Executes the given source code with the given rule libraries and returns the result
     * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
     */
    runRule(ruleText: string, librariesList: SelectizeLibrary[] = [], variables: Variable[] = [], includeWebClasses: boolean= false, async: boolean = true, ruleTimeout: number = 10) {
        if (ruleText === undefined) {
            throw new Error("Cannot run an empty rule");
        }
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/run');
        // TODO: Handle error output here
        return this.$http.post(PAGE_CONFIG_URL, {script: ruleText, libraries: librariesList, includeWebClasses: includeWebClasses, async: async, ruleTimeout: ruleTimeout.toString(10), variables: variables}).then(function(response) {
            //console.log(response.data)
            return response.data;
        });
    }

    /**
     * Executes the given source code with the given rule libraries and returns the result
     * @param {!string} uuid
     * @param logLevel
     * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
     */
    checkStatus(uuid, logLevel = LOG_DEBUG) {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/asyncUpdate');
        let config = {
            params: {
                uuid: uuid,
                logLevel: logLevel
            }
        }
        // TODO: Handle error output here
        return this.$http.get(PAGE_CONFIG_URL, config).then(function(response) {
            //console.log(response.data)
            return response.data;
        });
    }

    /**
     * Executes the given source code with the given rule libraries and returns the result
     * @param {!string} uuid
     * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
     */
    asyncAbort(uuid) {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/asyncAbort');
        let params = {
            uuid: uuid,
            logLevel: LOG_DEBUG
        }
        // TODO: Handle error output here
        return this.$http.post(PAGE_CONFIG_URL, params).then(function(response) {
            //console.log(response.data)
            return response.data;
        });
    }

    getMyHistory() {
        let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/history');

        // TODO: Handle error output here
        return this.$http.get(PAGE_CONFIG_URL).then(function(response) {
            //console.log(response.data)
            return response.data as StoredHistoryItem[];
        });
    }
}

/**
 * Services that handles functionality around the page configuration.
 */
ruleRunnerModule.service('ruleRunnerService', RuleRunnerService)
