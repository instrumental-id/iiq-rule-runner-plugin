/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {RunningRule} from "../../RunningRule.js";
import {LogMessage} from "../../types.js";
import {notNullOrEmpty} from "../../utils.js";

export type RenderedOutputType = "xml" | "json" | "string"

export class RenderedOutput {
    output: string | null;
    xml: string | null;
    json: string | null;

    constructor() {
        this.output = null;
        this.xml = null;
        this.json = null;
    }

    present(): boolean {
        return (
            notNullOrEmpty(this.xml) ||
            notNullOrEmpty(this.json) ||
            notNullOrEmpty(this.output)
        );
    }

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

    reset() {
        this.output = null;
        this.xml = null;
        this.json = null;
    }
}

export class OutputState {
    lastUpdateObject: RunningRule | null;

    lastUpdate?: Date | null;

    errorMessage: string | null;

    readonly output: RenderedOutput;

    outputType: string | null;

    logs: LogMessage[];

    stats: Object | null;

    hostname: string | null;

    aborting: boolean;

    lastAbortTime: Date | null;

    constructor() {
        this.errorMessage = null;
        this.outputType = null;
        this.output = new RenderedOutput();
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

    reset() {
        this.output.reset();

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