/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import "./IIQModule";

import "./services/RuleRunnerService"

import "./app";
import "./ApplicationState"

import "./model/RunningRule";
import "./model/OutputState";
import "./component/output/output.component"
import "./model/EditorState";
import "./component/editor/codemirror.component"
import "./component/editor/editor.component";
import "./component/editor/selectize.component";
import "./RuleVariableModalController"
import "./services/BrowserStorageService";
import "./services/RuleHistoryService";
import "./services/RunRuleService";
import "./services/CsvFileUploadService"

console.log(`


***
---------
IIQ Rule Runner Plugin
Instrumental Identity https://instrumentalidentity.com
https://git.identityworksllc.com/pub/sailpoint-plugins/rule-runner-public
---------
***



`)
