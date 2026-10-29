/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {ruleRunnerModule} from "../../IIQModule";

import {PLUGIN_NAME} from "../../app";
import {IPluginHelper} from "../../IIQModule";
import {OutputState} from "../../model/OutputState";
import {IScope, ITimeoutService} from "angular";
import {AngularScope, HasValue} from "../../types";
import {OutputStateUpdate} from "../../model/OutputStateUpdate";
import {EventBus, EventType} from "../../services/EventBus";
import {ApplicationState} from "../../ApplicationState";
import xmlFormat from 'xml-formatter';

declare var PluginHelper: IPluginHelper

export class OutputComponent {
    /**
     * The constant output state
     */
    private readonly state: OutputState;

    constructor(private applicationState: ApplicationState, private $scope: AngularScope & IScope, private eventBus: EventBus) {
        this.state = new OutputState();

        this.eventBus.registerSync(EventType.RULE_OUTPUT_UPDATED, async (update: OutputStateUpdate) => {
            let result: boolean = this.updateState(update);
            this.refresh()
            return result;
        })

        this.eventBus.register(EventType.STARTING_RULE_RUN, () => {
            this.start();
        })

        this.eventBus.register(EventType.FINISHED_RULE_RUN, () => {
            this.stop();
        })

        this.eventBus.register(EventType.ABORTED_RULE_RUN, () => {
            this.state.lastAbortTime = new Date();
        })
    }

    private start() {
        this.state.reset();
        this.refresh();
    }

    private stop() {
        // TODO stuff here
    }

    refresh() {
        if (this.running) {
            this.updateProgress()
        }
        try {
            this.$scope.$applyAsync()
        } catch(e) {
            // This can happen if the digest cycle is already running, so we just ignore it
        }
    }

    /**
     * Invoked via AngularJS, this will be used to get the latest parse error suggestion,
     * if one exists. This improves the ugly BSF error message to provide a more user-friendly
     * debugging experience.
     */
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

    /**
     * Returns the current 'running' state from the global application state.
     */
    get running(): boolean {
        return this.applicationState.running;
    }

    /**
     * Returns true if the error message indicates a Beanshell parse error, false otherwise
     * @returns {boolean} Returns true if the error message indicates a Beanshell parse error, false otherwise
     */
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

    getOutput(): string | object | null {
        if (this.isXml()) {
            let value = (this.state?.output.value ?? "") as string;
            return xmlFormat(value, {
                indentation: '  ', // Indentation with 2 spaces
            });
        } else if (this.isJson()) {
            return this.state?.output.value as object;
        }
        return (this.state?.output.value ?? null) as string;
    }

    /**
     * Updates the output state with the given update. This is invoked via the EventBus
     * on event `RULE_OUTPUT_UPDATED`. The UI will be automatically refreshed after this
     * method is called.
     *
     * @param update The update state to apply
     * @return {boolean} Returns true if the output state indicates a successful run, false otherwise
     * @private
     */
    private updateState(update: OutputStateUpdate): boolean {
        if (update === null) {
            console.warn("RunningRule.handleOutput called with null outputState, ignoring")
            return false;
        }
        // Cached stuff for use in code
        this.state.lastUpdate = new Date();
        this.state.lastUpdateObject = update.runningRule;

        // Output messages that get displayed directly in the UI
        this.state.clearOutput()

        if (update.host) {
            this.state.hostname = update.host
        }

        if (update.runningRule?.logs) {
            this.state.addLogs(update.runningRule?.logs);
        }
        this.state.stats = update.runningRule?.stats ?? null
        if (update.runningRule?.isError()) {
            this.state.errorMessage = update.runningRule?.getErrorString() ?? ""
        } else if (update.runningRule?.isDone()) {
            const output = update.runningRule?.output
            if (output.isNull) {
                this.state.output = {
                    type: "null",
                    displayType: "string",
                    value: "(rule returned null output)"
                }
                return true;
            } else if (typeof output.value === "object") {
                this.state.output = {
                    type: output.type || "",
                    displayType: "json",
                    value: JSON.stringify(output.value, null, 2)
                }
                return true;
            } else {
                let value = output.value || ""
                if (value.startsWith("\"")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, "\n")
                value = value.replace(/\\t/g, "\t")
                if (value.startsWith("<?xml")) {
                    this.state.output = {
                        type: output.type || "",
                        displayType: "xml",
                        value: value
                    }
                    return true;
                } else {
                    this.state.output = {
                        type: output.type || "",
                        displayType: "string",
                        value: value
                    }
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Updates the progress bar element with the current progress percentage.
     * @private
     */
    private updateProgress() {
        let progressElem = document.getElementById("idwRuleRunnerProgress") as unknown as HasValue

        let stats = this.state?.stats

        if (progressElem) {
            if (stats && "progressPercent" in stats && stats.progressPercent > 0) {
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
    }
})