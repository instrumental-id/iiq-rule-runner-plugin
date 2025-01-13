/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {LogMessage} from "./types.js";
import {OutputState} from "./component/output/OutputState.js";

export interface RuleOutputError {
    exception: string | null;
    message: string | null;
}

/**
 * The output of a rule after completion. This is one of two things:
 *  - A response value, which may be a string, JSON, or XML
 *  - An optional error message and exception trace
 */
export class RuleOutput {
    public done: boolean;
    public value: any | null;
    public type: string | null;
    public isNull : boolean;
    public exception : RuleOutputError;

    constructor() {
        /**
         * @type {boolean}
         */
        this.done = false;

        /**
         * @type {any}
         */
        this.value = null;

        /**
         * @type {null|string}
         */
        this.type = null;

        /**
         * @type {boolean}
         */
        this.isNull = false;

        /**
         * @type {RuleOutputError}
         */
        this.exception = {
            exception: null,
            message: null
        }
    }
}

export class RunningRule {
    public uuid?: string;

    public logs: LogMessage[];

    public stats: Object;

    public async: boolean | string;

    public host: string;

    public elapsed: number;

    public output: RuleOutput;

    constructor(json: any) {
        /**
         * @type {string}
         */
        this.uuid = json.uuid;

        /**
         * @type {LogMessage[]}
         */
        this.logs = json.logs ?? [];

        /**
         * @type {any}
         */
        this.stats = json.stats ?? {};

        /**
         * @type {boolean|string}
         */
        this.async = (json.async === true);

        /**
         * @type {string}
         */
        this.host = json.hostname || json.host || "??"

        /**
         * @type {number}
         */
        this.elapsed = Math.floor((json.elapsed ?? -1) / 1000.0 );

        /**
         * @type {RuleOutput}
         */
        this.output = new RuleOutput();

        // If "output" is in the JSON, it indicates that the job has finished
        if ("output" in json && json.output) {
            this.output.done = true
            this.output.value = json.output.value
            this.output.type = json.output.type
            this.output.isNull = json.output.isNull
            if ("exception" in json.output && json.output.exception) {
                this.output.exception = {
                    exception: json.output.exception.exception,
                    message: json.output.exception.message
                }
            }
        }
    }

    /**
     * Handles the output stored in this RunningRule by writing it to the provided
     * application state.
     *
     * @param {function(): void} saveCallback The AngularJS controller
     * @param {OutputState} outputState The state to which updates should be written
     */
    async handleOutput(saveCallback: () => void, outputState: OutputState): Promise<void> {
        // Cached stuff for use in code
        outputState.lastUpdate = new Date();
        outputState.lastUpdateObject = this;

        // Output messages that get displayed directly in the UI
        outputState.errorMessage = null
        outputState.output.json = null
        outputState.output.xml = null
        outputState.output.output = null

        if (this.host) {
            outputState.hostname = this.host
        }

        if (this.logs) {
            outputState.addLogs(this.logs);
        }
        outputState.stats = this.stats ?? null
        if (this.isError()) {
            outputState.errorMessage = this.getErrorString()
        } else if (this.isDone()) {
            let output = this.output
            if (output.isNull) {
                outputState.outputType = "null"
                outputState.output.output = "(rule returned null output)"
            } else if (typeof output.value === "object") {
                outputState.outputType = output.type
                outputState.output.json = output.value
                saveCallback();
            } else {
                let value = output.value || ""
                if (value.startsWith("\"")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, "\n")
                value = value.replace(/\\t/g, "\t")
                outputState.outputType = output.type;
                if (value.startsWith("<?xml")) {
                    outputState.output.xml = value
                    saveCallback();
                } else {
                    outputState.output.output = value
                    saveCallback();
                }
            }
        }
    }


    /**
     * @return {boolean} True if the running rule is asynchronously continuing
     */
    isAsync(): boolean {
        return (this.async === true || this.async === "true")
    }

    /**
     * @return {boolean} True if the running rule is done
     */
    isDone(): boolean {
        return this.output.done
    }

    /**
     * @return {boolean} True if the running rule has errors
     */
    isError(): boolean {
        return ("exception" in this.output && (this.output.exception.message !== null || this.output.exception.exception !== null))
    }

    getErrorString(): string | null {
        if (!this.isError()) {
            return null
        }
        if (this.output.exception.message) {
            return this.output.exception.message
        } else {
            return this.output.exception.exception
        }
    }
}