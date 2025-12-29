import {SelectizeLibrary, Variable} from "../types";
import {LoadedRule} from "./LoadedRule";

/**
 * The state of the editor component, which is used both as a storage mechanism
 * for historical runs and as a way to pass the data around at runtime.
 */
export interface EditorState {
    /**
     * The timestamp when this state was stored (i.e., in history)
     */
    timestamp?: number;
    /**
     * The date when this state was stored, in ISO format.
     */
    date?: string;
    /**
     * A list of rule libraries selected by the user
     */
    libraries: Array<SelectizeLibrary>;

    /**
     * The source code entered in the editor.
     */
    source: string;

    /**
     * A loaded rule, containing the pre-edit state of a rule pulled up by the user to edit
     */
    loadedRule: LoadedRule | null;

    /**
     * The timeout for the rule execution, in minutes
     */
    timeout: number;

    /**
     * If true, execution will be asynchronous
     */
    async: boolean;

    /**
     * The state of the checkbox indicating that we should lint with workflow variables included
     */
    isWorkflowRuleLibrary: boolean;

    /**
     * The state of the checkbox indicating that certain Beanshell errors will be ignored
     */
    suppressRawTypeErrors: boolean;

    /**
     * The state of the checkbox indicating that we should include web classes in the rule execution
     */
    includeWebClasses: boolean;

    /**
     * A list of variables defined by the user
     */
    variables?: Array<Variable>;
    
    /**
     * The CSV file(s?) uploaded by the user for use in the rule execution
     */
    csvFile?: FileList | null;
    
    csvHasHeaders?: boolean;
    
    csvErrorOnShortLines?: boolean;
}

export function defaultEditorState(): EditorState {
    return {
        libraries: [],
        source: "",
        loadedRule: null,
        timeout: 10,
        async: true,
        isWorkflowRuleLibrary: false,
        suppressRawTypeErrors: false,
        includeWebClasses: false,
        variables: [],
        csvFile: null,
        csvHasHeaders: true,
        csvErrorOnShortLines: false
    };
}