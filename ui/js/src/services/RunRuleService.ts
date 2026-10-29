import {ruleRunnerModule} from "../IIQModule";

import {ApplicationState} from "../ApplicationState";
import {RuleHistoryService} from "./RuleHistoryService";
import {EditorState} from "../model/EditorState";
import {RunningRule} from "../model/RunningRule";
import {
    EventBus, EventType
} from "./EventBus";
import {RuleRunnerService, RunRuleOptions} from "./RuleRunnerService";
import {OutputComponent} from "../component/output/output.component";
import {ITimeoutService} from "angular";
import {OutputStateUpdate} from "../model/OutputStateUpdate";
import {LogLevel} from "../types";

const RUNNING_RULE_CHECK_TIMEOUT_MS: number = 2000;

async function handleOutput(eventBus: EventBus, runningRule: RunningRule | null): Promise<boolean | null> {
    let message: OutputStateUpdate = {
        host: runningRule?.host || "",
        runningRule: runningRule,
    }

    await eventBus.publish(EventType.RULE_OUTPUT_UPDATED, message)

    return await eventBus.publishSync(EventType.RULE_OUTPUT_UPDATED, message);
}

/**
 * The service responsible for running rules on the server and updating the
 * output based on the feedback from the API
 */
export class RunRuleService {
    logLevel: LogLevel = "Debug";

    lastUpdateObject: RunningRule | null = null;

    constructor(private ruleHistoryService: RuleHistoryService, private ruleRunnerService: RuleRunnerService, private applicationState: ApplicationState, private eventBus: EventBus, private $timeout: ITimeoutService) {

    }

    /**
     * Saves the next round of execution history into browser local storage
     */
    async saveHistory(state: EditorState) {
        this.applicationState.executionHistory = await this.ruleHistoryService.saveHistory(state)
    }

    async abortRule() {
        if (this.applicationState.running && this.lastUpdateObject && this.lastUpdateObject.uuid) {
            let uuid = this.lastUpdateObject.uuid
            console.debug("Aborting running rule with UUID " + uuid)

            await this.eventBus.publish(EventType.ABORTING_RULE_RUN, {
                uuid: uuid,
                runningRule: this.lastUpdateObject
            });

            this.applicationState.aborting = true;

            this.ruleRunnerService.asyncAbort(uuid).then((output: any) => {
                let runningRule = new RunningRule(output);
                this.lastUpdateObject = null;
                handleOutput(this.eventBus, runningRule).then(() => {
                    this.eventBus.publish(EventType.ABORTED_RULE_RUN, {

                    });

                    this.eventBus.publish(EventType.FINISHED_RULE_RUN, {
                        state: null,
                        aborted: true,
                        runningRule: runningRule
                    });
                })
                this.applicationState.running = false;
            })
        }
    }

    /**
     * Runs the rule on the server, then kicks off the monitoring process to update
     * the output components intermittently.
     *
     * @param state The editor state containing the rule execution context.
     * @return The RunningRule object representing the execution, or null if no rule was run
     */
    async runRule(state: EditorState): Promise<RunningRule | null> {
        if (state.source.trim() === "") {
            return Promise.resolve(null);
        }

        this.lastUpdateObject = null;

        await this.eventBus.publish(EventType.STARTING_RULE_RUN, {
            state: state
        });

        await this.eventBus.publish(EventType.SOURCE_CHANGED, {
            source: state.source
        })
        
        this.applicationState.panels.resultselem = true;
        
        let options = new RunRuleOptions()
        options.includeWebClasses = state.includeWebClasses ?? false
        options.async = state.async ?? true
        options.ruleTimeout = state.timeout ?? 10
        options.librariesList = state.libraries
        options.variables = state.variables ?? []

        return this.ruleRunnerService.runRule(state.source ?? "", options).then((output: any) => {
            let runningRule = new RunningRule(output);
            this.lastUpdateObject = runningRule;

            handleOutput(this.eventBus, runningRule).then((done) => {
                if (done) {
                    this.saveHistory(state);
                }
            })

            if (runningRule.isAsync()) {
                if (!runningRule.isDone()) {
                    const uuid: string = runningRule.uuid ?? "";
                    this.$timeout( () => {
                        this.checkStatus(state, uuid)
                    }, RUNNING_RULE_CHECK_TIMEOUT_MS)
                } else {
                    this.notifyStopped(state, runningRule);
                }
            } else {
                this.notifyStopped(state, runningRule);
            }

            if(this.applicationState.hideDocumentation){
                this.applicationState.panels.documentationelem = false;
            }

            return runningRule
        })
    }
    
    /**
     * Notify any listeners that the rule has stopped running
     * @param state The editor state containing the rule execution context.
     * @param runningRule The running rule that has stopped.
     * @private
     */
    private notifyStopped(state: EditorState, runningRule: RunningRule) {
        this.eventBus.publish(EventType.FINISHED_RULE_RUN, {
            state: state,
            aborted: false,
            runningRule: runningRule
        });
    }

    /**
     * Checks the status of a running rule by its UUID. This is invoked in a loop (via $timeout)
     * until the rule is done running.
     *
     * @param state The editor state containing the rule execution context.
     * @param uuid The UUID of the running rule to check.
     * @private
     */
    private checkStatus(state: EditorState, uuid: string) {
        if (this.applicationState.running) {
            this.ruleRunnerService.checkStatus(uuid, this.logLevel).then((output: any) => {
                let runningRule = new RunningRule(output);
                this.lastUpdateObject = runningRule;
                handleOutput(this.eventBus, runningRule).then((done) => {
                    if (done) {
                        this.saveHistory(state);
                    }
                })
                if (!runningRule.isDone()) {
                    if (!runningRule.uuid) {
                        console.error("Received output without a UUID??", runningRule)
                    } else {
                        const nextUuid = runningRule.uuid;
                        this.$timeout(() => {
                            this.checkStatus(state, nextUuid)
                        }, RUNNING_RULE_CHECK_TIMEOUT_MS)
                    }
                } else {
                    this.notifyStopped(state, runningRule);
                }
            })
        }
    }

}

ruleRunnerModule.service("runRuleService", RunRuleService);