/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

export interface ISailPointStatic {
    CONTEXT_PATH: string;

    CURR_DISPLAYABLE_USER_NAME: string;

    CURR_USER_ID: string;

    CURR_USER_LOCALE: string;

    CURR_USER_NAME: string;

    REVISION: string;

    SESSION_TIMEOUT: string;

    SYSTEM_ADMIN: boolean | string;

    getBrowserViewArea(): { height: number, width: number }

    getCsrfToken(): string;

    getRelativeUrl(path: string): string;

    sanitizeHtml(html: string): string;
}

/**
 * Shim around Sailpoint's PluginHelper
 */
export interface IPluginHelper {
    addSnippetController(moduleName, innerHtml, selector): void;

    addWidgetFunction(func: Function): void;

    getCsrfToken(): string;

    getCurrentUserId(): string;

    getCurrentUsername(): string;

    getCurrentUserDisplayableName(): string;

    getPluginFileUrl(pluginName: string, pluginPath: string): string;

    getPluginRestUrl(path: string): string;

    loadWidgetFunctions(): void;
}

declare var PluginHelper: IPluginHelper;

declare var SailPoint: ISailPointStatic;

import {IAngularStatic} from "angular";
declare var angular: IAngularStatic;

export const ruleRunnerModule = angular.module('RuleRunnerPluginModule',  ['ngSanitize', 'ui.bootstrap', 'angular-json-tree']);
