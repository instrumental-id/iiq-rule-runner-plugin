/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {ruleRunnerModule} from "../../init.js";
import {PLUGIN_NAME} from "../../app.js";
import {IPluginHelper} from "../../IIQModule.js";
import {OutputState} from "./OutputState.js";
import {IOnChangesObject, ITimeoutService} from "angular";
import {HasValue} from "../../types.js";

declare var PluginHelper: IPluginHelper

export class OutputComponent {
    /**
     * Injected by Angular
     */
    state: OutputState | null;

    running: boolean;

    constructor(private $timeout: ITimeoutService) {
        this.state = null;
        this.running = false;
    }

    poll() {
        this.$timeout(() => {
            this.updateProgress()
            if (this.running) {
                this.poll()
            }
        }, 500, true)
    }

    $onChanges(changes: IOnChangesObject) {
        this.updateProgress()

        if (changes.running) {
            let runningChange = changes.running
            if (runningChange.currentValue === true) {
                this.poll();
            }
        }
    }

    get parseErrorSuggestion(): string | null {
        if (this.isParseError()) {
            let msg = this.state?.errorMessage
            if (msg) {
                if (msg.indexOf("Error in method invocation") < msg.indexOf(": in file:")) {
                    return msg.substring(msg.indexOf("Error in method invocation"), msg.indexOf(": in file:"));
                } else if (msg.indexOf("bsh.ParseException") < msg.indexOf("BSF info:")) {
                    return msg.substring(msg.indexOf("bsh.ParseException"), msg.indexOf("BSF info:"))
                }
            }
        }

        return null;
    }

    isParseError(): boolean {
        if (this.state?.errorMessage) {
            let msg = this.state?.errorMessage
            if (
                msg?.includes("bsh.ParseException") ||
                (msg?.includes("bsh.EvalError") && msg?.includes("Error in method invocation"))
            ) {
                return true;
            }
        }

        return false;
    }

    get stats(): object | null {
        return this.state?.stats ?? null
    }

    isJson() {
        return (this.state?.output.kind === "json")
    }

    isXml() {
        return (this.state?.output.kind === "xml")
    }

    isString() {
        return (this.state?.output.kind === "string");
    }

    getOutput(): string | null {
        let result: string | null = null;

        if (this.isXml()) {
            result = this.state?.output.xml ?? null
        } else if (this.isJson()) {
            result = this.state?.output.json ?? null
        } else {
            result = this.state?.output.output ?? null
        }

        return result;
    }

    updateProgress() {
        let progressElem = document.getElementById("idwRuleRunnerProgress") as unknown as HasValue

        let stats = this.state?.stats

        if (progressElem) {
            if (stats && "progressPercent" in stats) {
                progressElem.value = stats.progressPercent
            } else {
                progressElem.value = null
            }
        }
    }

}

ruleRunnerModule.component('renderOutput', {
    controller: OutputComponent,
    templateUrl: function () {
        return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/component/output/output.component.html")
    },
    bindings: {
        'state': '<',
        'running': '<'
    }
})