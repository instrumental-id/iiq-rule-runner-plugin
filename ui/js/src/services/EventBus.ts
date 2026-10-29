import {ruleRunnerModule} from "../IIQModule";
import {SelectizeLibrary} from "../types";
import {OutputStateUpdate} from "../model/OutputStateUpdate";
import {
    AbortingRuleRunPayload, EditorJumpToLinePayload,
    FinishedRuleRunPayload, LintingCompletePayload,
    SelectizeLibrariesPayload,
    SourcePayload,
    StartingRuleRunPayload, StringLibrariesPayload
} from "./EventPayloads";
import {EditorState} from "../model/EditorState";

/**
 * A listener function that is called synchronously when an event is published.
 * The function may return a value to the publisher.
 */
export type SynchronousListener<T extends EventType> = (args: EventPayloads<T>) => Promise<SyncEventOutputs<T>>;

export type AsynchronousListener<T extends EventType> = (args: EventPayloads<T>) => void;

const E_DARKMODE = "editor.darkMode";
const E_JUMP_TO_LINE = "editor.jumpToLine";
const E_FORCE_LINT = "editor.forceLint";

const E_EDITOR_READY = "editor.ready";

const E_SOURCE_CHANGED = "editor.sourceChanged"

const E_SOURCE_LOADED = "app.sourceLoaded";

const E_RULE_LIBRARIES_FORCE_SELECT = "app.ruleLibrariesForceSelect";

const E_RULE_LIBRARIES_SELECTED = "app.ruleLibrariesSelected";

const E_RULE_LIBRARIES_LOADED = "app.ruleLibrariesLoaded";

const E_STATE_UPDATED = "app.stateUpdated";

const E_RESTORE_HISTORY = "app.restoreHistory";

const E_SAVED_RULE = "app.savedRule";

const E_STARTING_RULE_RUN = "run.starting"

/**
 * The output of the currently-running rule has been updated and needs to be
 * reflected in the UI.
 */
const E_RULE_OUTPUT_UPDATED = "run.outputUpdated"

/**
 * The user has requested to abort the currently running rule, and the
 * server has been notified of this request.
 */
const E_ABORTING_RULE_RUN = "run.aborting"

/**
 * The rule has aborted successfully and control should be returned to the user
 */
const E_ABORTED_RULE_RUN = "run.aborted"

const E_FINISHED_RULE_RUN = "run.finished"

const E_REGISTER_EDITOR = "component.register.editor"


export enum EventType {
    DARKMODE = E_DARKMODE,
    JUMP_TO_LINE = E_JUMP_TO_LINE,
    FORCE_LINT = E_FORCE_LINT,
    EDITOR_READY = E_EDITOR_READY,
    EDITOR_GENERATE_VARIABLES = "editor.generateVariables",
    EDITOR_LINTING_COMPLETE = "editor.lintingComplete",
    SOURCE_CHANGED = E_SOURCE_CHANGED,
    SOURCE_LOADED = E_SOURCE_LOADED,
    RULE_LIBRARIES_FORCE_SELECT = E_RULE_LIBRARIES_FORCE_SELECT,
    RULE_LIBRARIES_SELECTED = E_RULE_LIBRARIES_SELECTED,
    RULE_LIBRARIES_LOADED = E_RULE_LIBRARIES_LOADED,
    STATE_UPDATED = E_STATE_UPDATED,
    RESTORE_HISTORY = E_RESTORE_HISTORY,
    SAVED_RULE = E_SAVED_RULE,
    STARTING_RULE_RUN = E_STARTING_RULE_RUN,
    RULE_OUTPUT_UPDATED = E_RULE_OUTPUT_UPDATED,
    ABORTING_RULE_RUN = E_ABORTING_RULE_RUN,
    ABORTED_RULE_RUN = E_ABORTED_RULE_RUN,
    FINISHED_RULE_RUN = E_FINISHED_RULE_RUN,
    REGISTER_EDITOR = E_REGISTER_EDITOR,
}

/**
 * Magic Typescript type that maps an EventType to its corresponding payload interface,
 * so we can enforce payload contents at compile time!
 */
export type EventPayloads<T> =
    T extends EventType.RULE_OUTPUT_UPDATED ? OutputStateUpdate
        : T extends EventType.SOURCE_CHANGED ? SourcePayload
        : T extends EventType.SOURCE_LOADED ? SourcePayload
        : T extends EventType.EDITOR_READY ? SourcePayload
        : T extends EventType.ABORTING_RULE_RUN ? AbortingRuleRunPayload
        : T extends EventType.STARTING_RULE_RUN ? StartingRuleRunPayload
        : T extends EventType.FINISHED_RULE_RUN ? FinishedRuleRunPayload
        : T extends EventType.RULE_LIBRARIES_SELECTED ? StringLibrariesPayload
        : T extends EventType.RULE_LIBRARIES_FORCE_SELECT ? SelectizeLibrariesPayload
        : T extends EventType.RULE_LIBRARIES_LOADED ? SelectizeLibrariesPayload
        : T extends EventType.EDITOR_LINTING_COMPLETE ? LintingCompletePayload
        : T extends EventType.JUMP_TO_LINE ? EditorJumpToLinePayload
        : T extends EventType.STATE_UPDATED ? { state: EditorState }
        : T extends EventType.DARKMODE ? { darkMode: boolean }
        : any;

/**
 * Magic Typescript type that map an EventType to its corresponding synchronous
 * output type.
 */
export type SyncEventOutputs<T> =
    T extends EventType.RULE_OUTPUT_UPDATED ? boolean
        : any

/**
 * Transmits events between components that are otherwise not connected. This is a
 * straightforward pub/sub implementation.
 */
export class EventBus {
    /**
     * Holds the list of async listeners for each event.
     * @private
     */
    private readonly listeners: {
        [K in EventType]?: Array<AsynchronousListener<K>>
    }
    
    /**
     * Holds a single synchronous listener for each event. The listener function
     * may return a value to the publisher.
     *
     * @private
     */
    private readonly syncListeners: {
        [K in EventType]?: SynchronousListener<K>
    };

    constructor() {
        this.listeners = {};
        this.syncListeners = {};
    }
    
    /**
     * Asynchronously publishes an event to all registered listeners. The receiving
     * function does not return any value.
     *
     * @param event The event name
     * @param args The arguments to pass to the listener functions
     */
    async publish<T extends EventType>(event: T, args: EventPayloads<T>): Promise<void> {
        console.log("Event: " + event);
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(args));
        }
    }

    /**
     * Synchronously publishes an event to a single registered listener. The receiving
     * function returns a value.
     *
     * @param event The event name
     * @param args The arguments to pass to the listener function
     * @return The return value of the listener function, or null if no listener is registered
     */
    async publishSync<T extends EventType>(event: T, args: EventPayloads<T>): Promise<SyncEventOutputs<T> | null> {
        console.log("Event: " + event);
        if (this.syncListeners[event]) {
            return await this.syncListeners[event](args);
        } else {
            console.warn(`No sync listener registered for event: ${event}`);
            return null;
        }
    }
    
    /**
     * Registers a callback for the given event type. The callback must accept a single
     * argument of the appropriate payload type for the event.
     *
     * @param event The event name
     * @param callback The callback function to register
     */
    register<T extends EventType>(event: T, callback: AsynchronousListener<T>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    
    /**
     * Registers a synchronous callback for the given event type. Only one synchronous
     * listener can be registered across the entire application. An attempt to register
     * a second listener will throw an error.
     *
     * The callback must accept a single argument of the appropriate payload type for the event,
     * and may return a value to the publisher.
     *
     * @param event The event name
     * @param callback The callback function to register
     */
    registerSync<T extends EventType>(event: T, callback: SynchronousListener<T>): void {
        if (!this.syncListeners[event]) {
            this.syncListeners[event] = callback as any;
        } else {
            throw new Error(`Sync listener for event ${event} already exists.`);
        }
    }

}

ruleRunnerModule.service("eventBus", EventBus);