import {EditorState} from "./model/EditorState";
import {ruleRunnerModule} from "./IIQModule";
import {EventBus, EventType} from "./services/EventBus";
import {FileUploadResponse} from "./services/RuleRunnerService";

/**
 * The state of the Rule Runner application, shared as a service across
 * many components.
 */
export class ApplicationState {

    aborting: boolean = false;

    /**
     * Indicates that some server operation is currently running which should
     * prevent the user from interacting with certain features.
     */
    running: boolean = false;

    /**
     * Set when the application has fully loaded and is ready for interaction
     */
    fullyLoaded: boolean = false;

    /**
     * The checkbox in the history section that allows the user to filter
     * by recent runs only.
     */
    showRecentOnly: boolean = true;

    /**
     * Indicates whether the documentation panel should be hidden on run
     */
    hideDocumentation: boolean = true;

    /**
     * Stores the state of the documentation panel at the time of execution
     */
    isDocumentationOpen: boolean = false;

    generateVariables: boolean = false;

    showingExecutionHistory: boolean = false;

    /**
     * The panels that are currently open in the application.
     */
    panels: { [key: string]: boolean } = {
        /**
         * Indicates whether the documentation panel is open.
         */
        documentationelem: false,

        /**
         * Indicates whether the history panel is open.
         */
        historyelem: false,

        /**
         * Indicates whether the results panel is open.
         */
        resultselem: false
    }

    /**
     * The execution history, which is loaded from either the browser local storage
     * or the server, depending on the starting condition.
     */
    executionHistory: EditorState[] = [];
    
    /**
     * The last uploaded CSV file information
     */
    lastUploadedCsvFile: FileUploadResponse | null = null;
    
    /**
     * Application state listens to events to update its own state and notify
     * other downstream listeners (once we convert to signals in Angular)
     * @param eventBus
     */
    constructor(private eventBus: EventBus) {
        this.eventBus.register(EventType.STARTING_RULE_RUN, () => {
            this.running = true;
            this.aborting = false;
        })
        this.eventBus.register(EventType.ABORTING_RULE_RUN, () => {
            this.aborting = true;
        })
        this.eventBus.register(EventType.ABORTED_RULE_RUN, () => {
            this.running = false;
            this.aborting = false;
        })
        this.eventBus.register(EventType.FINISHED_RULE_RUN, () => {
            this.running = false;
            this.aborting = false;
        });
    }

    /**
     * Closes all closable panels in the application
     */
    closeAll() {
        this.panels.documentationelem = false;
        this.panels.historyelem = false;
        this.panels.resultelem = false;
    }
}

ruleRunnerModule.service("applicationState", ApplicationState);