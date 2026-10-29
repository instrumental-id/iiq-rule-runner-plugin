import {RunningRule} from "../model/RunningRule";
import {EditorState} from "../model/EditorState";
import {SelectizeLibrary} from "../types";

export interface StartingRuleRunPayload {
    state: any;
}

export interface FinishedRuleRunPayload {
    state: EditorState | null;
    
    aborted: boolean;
    
    runningRule: RunningRule | null;
}

export interface SelectizeLibrariesPayload {
    libraries: SelectizeLibrary[]
}

export interface StringLibrariesPayload {
    libraries: string[]
}

export interface EditorJumpToLinePayload {
    lineNumber: number;
}

export interface SourcePayload {
    source: string;
}

export interface AbortingRuleRunPayload {
    uuid: string;
    
    runningRule: RunningRule | null;
}

export interface LintingCompletePayload {
    errors: any[];
    
    warnings?: any[];
    
    errorCount: number
}