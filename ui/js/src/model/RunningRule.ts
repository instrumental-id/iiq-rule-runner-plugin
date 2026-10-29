/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {LogMessage} from "../types";

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

export interface RunningRuleStats {
    progressString: string;

    progressPercent: number;

    progressAmount: number;

    progressMax: number;

    completed: number;
}

export class RunningRule {
    public uuid?: string;

    public logs: LogMessage[];

    public stats: RunningRuleStats;

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