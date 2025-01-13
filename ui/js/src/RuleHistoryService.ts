/**
 * SailPoint IdentityIQ plugin AngularJS page to run rules in the browser
 * (C) 2023-2024 Devin Rosenbauer
 * (C) 2019-2022 Identity Works LLC d/b/a Instrumental Identity
 *
 * See the LICENSE file for more details on permitted use
 *
 * https://www.instrumentalidentity.com
 */

import {LoadedRule} from "./LoadedRule.js";
import {ITimeoutService} from "angular";
import {RuleRunnerService} from "./RuleRunnerService.js";
import {SelectizeLibrary} from "./types.js";

import {IAngularStatic} from "angular";
import {ruleRunnerModule} from "./init.js";
declare var angular: IAngularStatic;

type LocalForageValue = (String|Array<any>|ArrayBuffer|Blob|Number|Object);

interface LocalForage {
    getItem(key: string): Promise<LocalForageValue>;
    setItem(key: string, value: LocalForageValue): Promise<LocalForageValue>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
}

export interface SourceObject {
    source: string;
    ruleLibraries: Array<SelectizeLibrary>;
    async: boolean;
    includeWebClasses: boolean;
    loadedRule: LoadedRule | null;
}

export interface EditorState {
    timestamp?: number;
    date?: string;
    libraries: Array<SelectizeLibrary>;
    source: string;
    loadedRule: LoadedRule | null;
    timeout: number;
    async: boolean;
    isWorkflowRuleLibrary: boolean;
    suppressRawTypeErrors: boolean;
    includeWebClasses: boolean;
}

function stateMatches(state1: EditorState, state2: EditorState) {
    return (state1.source === state2.source && JSON.stringify(state1.libraries.sort()) === JSON.stringify(state2.libraries.sort()));
}

const EXECUTION_HISTORY_ENTRY = "idw.rulerunner.executionhistory";
const LAST_SOURCE_ENTRY = "idw.rulerunner.last";
const EMPTY_HISTORY_STRING = "[]"

export class RuleHistoryService {
    private localforage: LocalForage;

    private history: EditorState[];

    constructor(private ruleRunnerService: RuleRunnerService, private $timeout: ITimeoutService) {
        // @ts-ignore
        this.localforage = window.localforage

        this.history = []
    }

    async loadServerHistory() {
        let history = await this.getOrBootstrapExecutionHistory(false)

        return this.ruleRunnerService.getMyHistory().then((json) => {

            for (let row of json) {
                let date = row.timestamp ? new Date(row.timestamp) : new Date();
                let libraries: string[] = row.libraries || []

                let execution: EditorState = {
                    timestamp: date.getTime(),
                    date: date.toISOString(),
                    source: row.source || "",
                    libraries: libraries.map((item) => {
                        return {title: item}
                    }),
                    loadedRule: null,
                    timeout: 10,
                    includeWebClasses: row.includeWebClasses || false,
                    suppressRawTypeErrors: false,
                    isWorkflowRuleLibrary: false,
                    async: true
                }

                let foundIndex: number;
                do {
                    foundIndex = -1;
                    for (let index = 0; index < history.length; index++) {
                        let historyItem = history[index]
                        if (historyItem.source === execution.source && JSON.stringify(historyItem.libraries.sort()) === JSON.stringify(execution.libraries.sort())) {
                            foundIndex = index;
                            break;
                        }
                    }

                    if (foundIndex >= 0) {
                        history.splice(foundIndex, 1)
                    }
                } while (foundIndex >= 0);

                history.push(execution)

                this.localforage.setItem(EXECUTION_HISTORY_ENTRY, JSON.stringify(history))
            }

            this.history = history;

            return this.history;
        });
    }

    async getLastSource(): Promise<EditorState> {
        let lastSourceString: string = localStorage.getItem(LAST_SOURCE_ENTRY) || ""

        if (!lastSourceString) {
            lastSourceString = (await this.localforage.getItem(LAST_SOURCE_ENTRY)) as string;
        }

        if (lastSourceString) {
            return JSON.parse(lastSourceString)
        } else {
            return {
                source: "",
                libraries: [],
                loadedRule: null,
                async: true,
                includeWebClasses: false,
                suppressRawTypeErrors: false,
                isWorkflowRuleLibrary: false,
                timeout: 10
            }
        }
    }

    async saveHistory(state: Partial<EditorState>): Promise<EditorState[]> {
        let history = await this.getOrBootstrapExecutionHistory(false)

        let now = new Date()

        let execution : EditorState = {
            timestamp: now.getTime(),
            date: now.toISOString(),
            source: state.source ?? "",
            timeout: state.timeout ?? 10,
            libraries: state.libraries || [],
            loadedRule: state.loadedRule ?? null,
            includeWebClasses: state.includeWebClasses || false,
            suppressRawTypeErrors: state.suppressRawTypeErrors || false,
            isWorkflowRuleLibrary : state.isWorkflowRuleLibrary || false,
            async: state.async || true
        }

        let foundIndex;
        do {
            foundIndex = -1;
            for(let index in history) {
                let historyItem = history[index]
                if (stateMatches(historyItem, execution)) {
                    foundIndex = index;
                    break;
                }
            }

            if (foundIndex >= 0) {
                history.splice(foundIndex, 1)
            }
        } while(foundIndex >= 0);

        history.push(execution)

        // 10M characters = 20 MB in UTF-16, which is the max we want to store in IndexedDB limit
        // Could store up to 50MB, but it's shared across the whole origin, so we want to be
        // courteous to other plugins and IIQ itself.
        let maxLength = 10 * 1000 * 100
        let newHistoryString = JSON.stringify(history)
        while (newHistoryString.length > maxLength) {
            // Remove entries one at a time until we fit within the space
            history.shift()
            newHistoryString = JSON.stringify(history)
        }

        await this.localforage.setItem(EXECUTION_HISTORY_ENTRY, newHistoryString)

        return history;
    }

    /**
     * @param {boolean} allowLoad True if we want to allow loading from the server (pass false from the load itself to avoid a recursive loop)
     * @return {Promise<string>} The execution history (or a new [])
     */
    async getOrBootstrapExecutionHistory(allowLoad: boolean = false): Promise<EditorState[]> {
        let storedHistory: string = (await this.localforage.getItem(EXECUTION_HISTORY_ENTRY) as string)
        if (storedHistory == null && allowLoad) {
            return (await this.loadServerHistory())
        } else {
            return JSON.parse(storedHistory || EMPTY_HISTORY_STRING)
        }
    }

    async saveSource(sourceObject: SourceObject) {
        const object: Partial<EditorState> = {
            source: sourceObject.source,
            libraries: sourceObject.ruleLibraries,
            async: sourceObject.async,
            includeWebClasses: sourceObject.includeWebClasses,
            loadedRule: sourceObject.loadedRule
        }

        return await this.localforage.setItem(LAST_SOURCE_ENTRY, JSON.stringify(object))
    }
}

ruleRunnerModule.service('ruleHistoryService', RuleHistoryService);