/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {IAngularStatic} from "angular";

declare var angular: IAngularStatic;

export let ruleRunnerModule = angular.module('RuleRunnerPluginModule',  ['ngSanitize', 'ui.bootstrap', 'ui.codemirror', 'jsonFormatter', 'prettyXml', 'selectize']);

console.log(`


***
---------
IIQ Rule Runner Plugin
Instrumental Identity https://instrumentalidentity.com
https://git.identityworksllc.com/pub/sailpoint-plugins/rule-runner-public
---------
***



`)