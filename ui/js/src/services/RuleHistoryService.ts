/**
 * SailPoint IdentityIQ plugin AngularJS page to run rules in the browser
 * (C) 2023-2025 Devin Rosenbauer
 * (C) 2019-2022 Identity Works LLC d/b/a Instrumental Identity
 *
 * See the LICENSE file for more details on permitted use
 *
 * https://www.instrumentalidentity.com
 */
import {ruleRunnerModule} from "../IIQModule";

import {LoadedRule} from "../model/LoadedRule";
import {ITimeoutService} from "angular";
import {RuleRunnerService} from "./RuleRunnerService";
import {SelectizeLibrary, Variable} from "../types";
import {EditorState} from "../model/EditorState";
import {BrowserStorageService} from "./BrowserStorageService";

/**
 * The SourceObject is used to store the source code, libraries, and other
 * metadata about the rule being run. This will be serialized to localStorage
 * and also pushed to the server when saving the rule.
 */
export interface SourceObject {
    source: string;
    ruleLibraries: Array<SelectizeLibrary>;
    async: boolean;
    includeWebClasses: boolean;
    loadedRule: LoadedRule | null;
    variables?: Array<Variable>;
}

function stateMatches(state1: EditorState, state2: EditorState) {
    return (state1.source === state2.source && JSON.stringify(state1.libraries.sort()) === JSON.stringify(state2.libraries.sort()));
}

/**
 * The key in localStorage where we store the execution history list
 */
const EXECUTION_HISTORY_ENTRY = "idw.rulerunner.executionhistory";

/**
 * The key in localStorage where we store the last source code and libraries
 */
const LAST_SOURCE_ENTRY = "idw.rulerunner.last";

/**
 * The default value of the execution history if nothing is found
 */
const EMPTY_HISTORY_STRING = "[]"

export class RuleHistoryService {
    constructor(private ruleRunnerService: RuleRunnerService, private $timeout: ITimeoutService, private browserStorageService: BrowserStorageService) {
        // @ts-ignore
        this.localforage = window.localforage
    }

    private filterForLength(history: EditorState[]): {json: string, history: EditorState[]} {
        let historyCopy = [...history];
        
        // 10M characters = 20 MB in UTF-16, which is the max we want to store in IndexedDB limit
        // Could store up to 50MB, but it's shared across the whole origin, so we want to be
        // courteous to other plugins and IIQ itself.
        
        const maxLength = 10_000_000; // 10 million characters
        
        let newHistoryString = JSON.stringify(historyCopy)
        while (newHistoryString.length > maxLength) {
            // Remove entries one at a time until we fit within the space
            historyCopy.shift()
            newHistoryString = JSON.stringify(historyCopy)
        }
        return {
            json: newHistoryString,
            history: historyCopy
        }
    }
    
    async getLastSource(): Promise<EditorState> {
        let lastSourceString: string = await this.browserStorageService.getItem(LAST_SOURCE_ENTRY) as string;

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
                
                this.removeMatchingHistoryEntries(history, execution);
                
                history.push(execution)
            }
            
            let filteredHistory = this.filterForLength(history);
            
            this.browserStorageService.setItem(EXECUTION_HISTORY_ENTRY, filteredHistory.json)
            
            return filteredHistory.history;
        });
    }
    
    /**
     * @param {boolean} allowLoad True if we want to allow loading from the server (pass false from the load itself to avoid a recursive loop)
     * @return {Promise<string>} The execution history (or a new [])
     */
    async getOrBootstrapExecutionHistory(allowLoad: boolean = false): Promise<EditorState[]> {
        console.log("Reading execution history from browser storage")
        let storedHistory: string = (await this.browserStorageService.getItem(EXECUTION_HISTORY_ENTRY) as string)
        if (storedHistory == null && allowLoad) {
            return (await this.loadServerHistory())
        } else {
            return JSON.parse(storedHistory || EMPTY_HISTORY_STRING)
        }
    }
    
    
    private removeMatchingHistoryEntries(history: EditorState[], execution: EditorState) {
        let foundIndex: number;
        do {
            foundIndex = -1;
            for (let index = 0; index < history.length; index++) {
                let historyItem = history[index]
                if (stateMatches(historyItem, execution)) {
                    foundIndex = index;
                    break;
                }
            }
            
            if (foundIndex >= 0) {
                history.splice(foundIndex, 1)
            }
        } while (foundIndex >= 0);
    }
    
    async saveHistory(state: Partial<EditorState>): Promise<EditorState[]> {
        let history = await this.getOrBootstrapExecutionHistory(false)
        
        let now = new Date()
        
        // Make a copy so that we can guarantee that we don't include anything we don't want to save
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
        
        this.removeMatchingHistoryEntries(history, execution);
        
        history.push(execution)
        
        let filteredOutput = this.filterForLength(history);
        
        await this.browserStorageService.setItem(EXECUTION_HISTORY_ENTRY, filteredOutput.json)
        
        return filteredOutput.history;
    }
    
    async saveSource(sourceObject: SourceObject) {
        const object: Partial<EditorState> = {
            source: sourceObject.source,
            libraries: sourceObject.ruleLibraries,
            async: sourceObject.async,
            includeWebClasses: sourceObject.includeWebClasses,
            loadedRule: sourceObject.loadedRule
        }

        return await this.browserStorageService.setItem(LAST_SOURCE_ENTRY, JSON.stringify(object))
    }
}

ruleRunnerModule.service('ruleHistoryService', RuleHistoryService);