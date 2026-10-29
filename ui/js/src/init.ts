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


/**
 * In installations that also feature the IID UI Plugin, we want to suppress hotkeys
 * on the Rule Runner page. Typing in the editor accidentally triggers hotkeys fairly
 * frequently, which is frustrating. If you don't use the UI Plugin, you don't need to
 * worry about what this is doing.
 *
 * @private
 */
export function suppressHotkeys(attempt: number = 0) {
    let done = false;

    if ("idwupeHotkeys" in window) {
        const hk = window["idwupeHotkeys"] as ((enabled: boolean) => void)
        if (hk) {
            // enabled = false
            hk(false)
            console.debug("Suppressed UI Plugin hotkey feature")
            done = true;
        }
    }

    if (!done && attempt < 10) {
        setTimeout(() => {
            suppressHotkeys(attempt + 1)
        }, 25)
    }
}

setTimeout(() => {
    suppressHotkeys(0)
}, 25)