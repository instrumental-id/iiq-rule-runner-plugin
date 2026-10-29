/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {RunningRule, RunningRuleStats} from "../model/RunningRule";
import {LogMessage} from "../types";
import {notNullOrEmpty} from "../utils";
import {isString} from "../utils";

export type RenderedOutputType = "xml" | "json" | "string"

/**
 * The external interface for the rendered output that will be displayed in the output panel.
 * This interface is used to provide a consistent way to access the output, regardless of its type.
 */
export interface RenderedOutput {
    get kind(): RenderedOutputType | null;

    reset(): void;

    get value(): string | object | null;
}

/**
 * The output that will be rendered in the output panel
 */
class RenderedOutputContainer implements RenderedOutput {
    /**
     * The output as a string, if any
     */
    output: string | null;

    /**
     * The output as XML, if any
     */
    xml: string | null;

    /**
     * The output as JSON, if any
     */
    json: object | null;

    constructor() {
        this.output = null;
        this.xml = null;
        this.json = null;
    }

    /**
     * Returns true if any of the output is present
     */
    present(): boolean {
        return (
            notNullOrEmpty(this.xml) ||
            notNullOrEmpty(this.json) ||
            notNullOrEmpty(this.output)
        );
    }

    /**
     * Returns the type of output that is present, or null if none is present.
     */
    get kind(): RenderedOutputType | null {
        if (this.present()) {
            if (notNullOrEmpty(this.output)) {
                return "string"
            } else if (notNullOrEmpty(this.xml)) {
                return "xml"
            } else if (notNullOrEmpty(this.json)) {
                return "json"
            }
        }

        return null;
    }

    /**
     * Resets the rendered output, clearing all fields.
     */
    reset() {
        this.output = null;
        this.xml = null;
        this.json = null;
    }

    /**
     * Gets the value of the rendered output, depending on the kind of output
     */
    get value(): string | object | null {
        switch(this.kind) {
            case "xml":
                return this.xml;
            case "json":
                return this.json;
            case "string":
                return this.output;
            default:
                return null;
        }
    }
}

export class OutputState {
    /**
     * The last running rule object that was updated, if any
     */
    lastUpdateObject: RunningRule | null;

    /**
     * The timestamp of the last update, if any
     */
    lastUpdate?: Date | null;

    /**
     * Any error messages to display (e.g., an exception trace)
     */
    errorMessage: string | null;

    /**
     * The rendered output that will be displayed in the output panel.
     */
    private readonly _output: RenderedOutputContainer;

    /**
     * The type of output that is present, if any.
     */
    outputType: string | null;

    /**
     * The logs that have been collected during the rule run.
     */
    logs: LogMessage[];

    /**
     * The last statistics object that was collected, if any.
     */
    stats: RunningRuleStats | null;

    /**
     * The hostname of the server that the rule was run on, if any.
     */
    hostname: string | null;

    /**
     * Whether the rule run is currently being aborted.
     */
    aborting: boolean;

    /**
     * The timestamp of the last abort action, if any.
     */
    lastAbortTime: Date | null;

    constructor() {
        this.errorMessage = null;
        this.outputType = null;
        this._output = new RenderedOutputContainer();
        this.lastUpdateObject = null;
        this.stats = null;
        this.hostname = null;
        this.aborting = false;
        this.lastAbortTime = null;

        this.logs = []
    }

    addLogs(newLogs: LogMessage[]) {
        for(let log of newLogs) {
            this.logs.push(log)
        }
    }

    clearOutput() {
        this._output.reset();
        this.outputType = null;
    }

    get output(): RenderedOutput {
        return this._output;
    }

    /**
     * Sets the output to the given value, which can be a string or an object with type and displayType.
     * In general, you will want to use the more complex object form, as it allows for more control over
     * how the output is displayed.
     *
     * @param value The output value to set. This can be a string or an object with type and displayType.
     */
    set output(value: string | {type: string | null, displayType: RenderedOutputType, value: string | null}) {
        this._output.reset();
        if (isString(value)) {
            this.outputType = null;
            this._output.output = value;
        } else {
            this.outputType = value.type;
            switch(value.displayType) {
                case "xml":
                    this._output.xml = value.value;
                    break;
                case "json":
                    const json = value.value || ""
                    this._output.json = JSON.parse(json);
                    break;
                case "string":
                    this._output.output = value.value;
                    break;
            }
        }
    }

    reset() {
        this._output.reset();

        this.errorMessage = null;
        this.outputType = null;
        this.lastUpdateObject = null;
        this.stats = null;
        this.hostname = null;
        this.aborting = false;
        this.lastAbortTime = null;

        this.logs = []
    }

}
