import {IPluginHelper, ruleRunnerModule} from "../../IIQModule";

import {defaultEditorState, EditorState} from "../../model/EditorState";
import {GENERATE_VARIABLES_SETTING, PLUGIN_NAME} from "../../app";
import {ApplicationState} from "../../ApplicationState";
import {
    EventBus, EventType
} from "../../services/EventBus";
import {EditorComponentScope, SelectizeLibrary} from "../../types";
import {ISCEService, IScope, ITimeoutService} from "angular";
import {RuleRunnerService} from "../../services/RuleRunnerService";
import {RuleHistoryService, SourceObject} from "../../services/RuleHistoryService";
import {LoadedRule} from "../../model/LoadedRule";
import {RuleVariable} from "../../model/RuleVariable";
import {RunRuleService} from "../../services/RunRuleService";
import {nullOrEmpty} from "../../utils";
import {SourcePayload, StringLibrariesPayload} from "../../services/EventPayloads";
import {CsvFileUploadService} from "../../services/CsvFileUploadService";

declare var PluginHelper: IPluginHelper;

export class EditorComponent {
    darkMode: boolean = false;

    state: EditorState;

    selectizeOptions: Selectize.IOptions<any, any>;

    optionsCollapsedState: {
        ruleOptions: boolean;
        uploadCsv: boolean;
    } = {
        ruleOptions: true,
        uploadCsv: false
    }

    constructor(private applicationState: ApplicationState, private ruleRunnerService: RuleRunnerService, private ruleHistoryService: RuleHistoryService, private eventBus: EventBus, private $scope: EditorComponentScope & IScope, private $timeout: ITimeoutService, private $uibModal: any, private runRuleService: RunRuleService, private $sce: ISCEService, private csvFileUploadService: CsvFileUploadService) {
        // Default initial state
        this.state = defaultEditorState();

        this.selectizeOptions = {
            maxItems: 10,
            searchField: ['title'],
            searchConjunction: 'and',
            valueField: 'title',
            labelField: 'title'
        }

        this.eventBus.register(EventType.EDITOR_READY, async () => {
            await this.loadLastState();
            this.toggleDarkMode()
        });
        
        this.eventBus.register(EventType.RULE_LIBRARIES_SELECTED, (args: StringLibrariesPayload) => {
            let array = args.libraries ?? [];
            
            this.state.libraries = array.map((lib) => {
                return {
                    title: lib,
                    id: lib
                } as SelectizeLibrary;
            });
            
            this.saveSource()
        });

        this.eventBus.register(EventType.SOURCE_CHANGED, (args: SourcePayload) => {
            this.state.source = args.source;
            this.saveSource()
        });

        this.eventBus.register(EventType.RESTORE_HISTORY, (args: EditorState) => {
            if (args) {
                this.restoreHistory(args);
            } else {
                this.restoreHistory(defaultEditorState());
            }
        });

        this.eventBus.register(EventType.EDITOR_LINTING_COMPLETE, (errors: {errors: any[], errorCount: number}) => {
            this.$scope.errors = errors.errors ?? []
            this.$scope.errorCount = errors.errorCount ?? 0
            if (this.$scope.nextErrorItem >= this.$scope.errors.length) {
                this.$scope.nextErrorItem = 0;
            }
        })

    }
    
    toggleOptionsCollapsed(which: string) {
        this.optionsCollapsedState[which] = !this.optionsCollapsedState[which];
    }

    $postLink() {
        console.log("Initializing editor component");

        this.$scope.$watch(() => this.state, () => {
            this.eventBus.publish(EventType.STATE_UPDATED, {
                state: this.state
            })
        });
        
        this.$scope.$watch(() => this.state.csvFile, async (newValue) => {
            if (newValue && newValue.length > 0) {
                let file = newValue[0];
                await this.csvFileUploadService.uploadCsvFile(file);
            } else {
                // TODO clear server-side CSV cache
                // Reset CSV inputs back to default
                this.state.csvHasHeaders = true;
                this.state.csvErrorOnShortLines = false;
                this.applicationState.lastUploadedCsvFile = null;
            }
            this.$scope.$applyAsync()
            
            // This is async, but we don't care about the output
            this.eventBus.publish(EventType.FORCE_LINT, {})
        })

        this.$scope.$watch(() => this.darkMode, (newValue) => {
            this.toggleDarkMode();
        });

        this.eventBus.publish(EventType.REGISTER_EDITOR, {
            editor: this
        })
    }

    async loadLastState() {
        let lastEntry: Partial<EditorState> = await this.ruleHistoryService.getLastSource()
        let existingVariables = this.state.variables ?? [];
        
        if (lastEntry?.source) {
            this.state = {
                timeout: 10,
                source: lastEntry.source,
                libraries: [],
                loadedRule: lastEntry.loadedRule?.name ? new LoadedRule(lastEntry.loadedRule) : null,
                includeWebClasses: lastEntry.includeWebClasses ?? false,
                async: lastEntry.async ?? true,
                isWorkflowRuleLibrary: lastEntry.isWorkflowRuleLibrary ?? false,
                suppressRawTypeErrors: lastEntry.suppressRawTypeErrors ?? false,
                variables: existingVariables,
                csvFile: null,
                csvHasHeaders: true,
                csvErrorOnShortLines: false
            };
            
            await this.eventBus.publish(EventType.SOURCE_LOADED, {source: this.state.source});
        }
        
        this.ruleRunnerService.getRuleLibraries().then(async (data: any) => {
            let options: any[] = []
            data.forEach((ruleName: string) => {
                options.push({
                    id: ruleName,
                    title: ruleName
                })
            });
            console.debug("Loaded available rule libraries: ", options);
            
            // Notify other components that the rule libraries have been loaded
            await this.eventBus.publish(EventType.RULE_LIBRARIES_LOADED, {
                libraries: options
            });
            
            let lastLibs = lastEntry?.libraries || []
            
            await this.eventBus.publish(EventType.RULE_LIBRARIES_FORCE_SELECT, {
                libraries: lastLibs
            });
            
            this.applicationState.fullyLoaded = true;
        });
    }
    
    /**
     * Restores the variables stored in the given HistoryEntry
     *
     * @param {EditorState} history
     */
    async restoreHistory(history: EditorState) {
        if (history === undefined || !("source" in history)) {
            throw "You cannot restore an undefined or empty history"
        }
        let existingVariables = this.state.variables ?? [];

        this.state = {
            timeout: 10,
            source: history.source,
            libraries: history.libraries,
            loadedRule: history.loadedRule ? new LoadedRule(history.loadedRule) : null,
            includeWebClasses: history.includeWebClasses ?? false,
            async: history.async ?? true,
            isWorkflowRuleLibrary: history.isWorkflowRuleLibrary ?? false,
            suppressRawTypeErrors: history.suppressRawTypeErrors ?? false,
            variables: existingVariables,
            csvFile: null,
            csvHasHeaders: true,
            csvErrorOnShortLines: false
        };

        await this.eventBus.publish(EventType.RULE_LIBRARIES_FORCE_SELECT, {
            libraries: history.libraries
        });
            
        this.eventBus.publish(EventType.SOURCE_LOADED, {source: this.state.source});
    }
    
    async clearUploadedCsv() {
        this.state.csvFile = null;
        
        await this.csvFileUploadService.clearUploadedCsvFile();
        
        let formElement = document.getElementById("csvFileInput") as HTMLInputElement;
        formElement.value = "";
        
        this.optionsCollapsedState.uploadCsv = true;
        
        await this.eventBus.publish(EventType.FORCE_LINT, {})
    }

    clearRule() {
        this.state.loadedRule = null;
        let fakeHistory: EditorState = {
            source: "",
            libraries: [],
            async: true,
            includeWebClasses: false,
            isWorkflowRuleLibrary: false,
            suppressRawTypeErrors: false,
            loadedRule: null,
            timeout: 10,
            csvFile: null,
            csvHasHeaders: true,
            csvErrorOnShortLines: false
        }
        this.eventBus.publish(EventType.RESTORE_HISTORY, fakeHistory);
    }

    /**
     * Starts the process of loading a rule
     */
    startLoadRule() {
        this.ruleRunnerService.getRuleTypes().then((ruleTypes) => {
            let modalInstance = this.$uibModal.open({
                animation: true,
                ariaLabelledBy: 'modal-title',
                ariaDescribedBy: 'modal-body',
                size: 'lg',
                templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/modal-choose-rule-template.html"),
                controller: 'RuleSelectionModalController',
                controllerAs: '$ctrl',
                resolve: {
                    state: function () {
                        return {
                            ruleTypes: ruleTypes
                        }
                    }
                }
            });

            modalInstance.result.then((selectedRule) => {
                if (selectedRule != null) {
                    let name = selectedRule["name"]
                    if (name != null) {
                        this.loadRule(name)
                    }
                }
            })
        })
    }

    toggleGenerateVariables() {
        console.log("Setting generate variables to " + this.applicationState.generateVariables)
        localStorage.setItem(GENERATE_VARIABLES_SETTING, String(this.applicationState.generateVariables));
    }

    startVariables() {
        let modalInstance = this.$uibModal.open({
            animation: true,
            ariaLabelledBy: 'modal-title',
            ariaDescribedBy: 'modal-body',
            size: 'lg',
            templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/modal-variableList.html"),
            controller: 'RuleVariableModalController',
            controllerAs: '$ctrl',
            resolve: {
                state: () => {
                    return {
                        variables: this.state.variables || []
                    }
                }
            }
        });

        modalInstance.result.then((output) => {
            if (output.variables) {
                this.state.variables = output.variables
            }
        })
    }

    /**
     * Scrolls the CodeMirror element to a particular error
     * @param {!number} errorNumber
     */
    scrollToError(errorNumber) {
        if (this.applicationState.fullyLoaded) {
            let errors = this.$scope.errors;
            if (errors) {
                let error = errors[errorNumber];
                if (error) {
                    this.eventBus.publish(EventType.JUMP_TO_LINE, {lineNumber: error._line});
                }
                this.$scope.nextErrorItem = errorNumber + 1
                if (this.$scope.nextErrorItem >= errors.length) {
                    this.$scope.nextErrorItem = 0;
                }
            }
        }
    }

    loadRule(name: string) {
        this.applicationState.running = true;
        this.ruleRunnerService.loadRule(name).then((output) => {
            if (typeof output === "string" && (output.startsWith("{") || output.startsWith("["))) {
                output = JSON.parse(output) as Partial<LoadedRule>
            }
            if (!output["name"]) {
                throw "Rule " + name + " not found"
            } else {
                // We got one

                // On load remove any auto added variables
                console.log("checking for variables to remove");
                if (this.state.variables) {
                    for (let i = this.state.variables.length - 1; i >= 0; i--) {
                        console.log(this.state.variables[i]);
                        if (this.state.variables[i].provided) {
                            console.log("removing variable");
                            this.state.variables.splice(i, 1);
                        }
                    }
                }

                this.state.loadedRule = new LoadedRule(output)
                console.log("Loaded rule output: ");
                console.log(output);

                /**
                 * @type {EditorState}
                 */
                let fakeHistory: EditorState = {
                    source: this.state.loadedRule.originalSource ?? "",
                    libraries: this.state.loadedRule.selectizeLibraries,
                    async: true,
                    includeWebClasses: false,
                    loadedRule: this.state.loadedRule,
                    isWorkflowRuleLibrary: false,
                    suppressRawTypeErrors: false,
                    timeout: 10,
                    variables: this.state.loadedRule.variables ?? [],
                    csvFile: null,
                    csvHasHeaders: true,
                    csvErrorOnShortLines: false
                }

                // Auto add found variables to loaded rule
                try {
                    if(this.applicationState.generateVariables) {
                        this.state.variables = this.state.variables ?? [];
                        console.log("Generating variables")
                        Object.entries(output["variables"]).forEach(([key, value]) => {
                            console.log(`${key} ${value}`);
                            let options = {
                                "provided": true,
                                "name": key,
                                "type": value
                            }
                            let ruleVariable = new RuleVariable(options);
                            this.state.variables?.push(ruleVariable);
                        });
                    }
                    else{
                        console.log("Not generating variables")
                    }

                } catch (error) {
                    console.log("Error adding variables to loaded rule: " + error);
                }

                console.log(this.state.variables);

                this.eventBus.publish(EventType.RESTORE_HISTORY, fakeHistory);
            }
            this.applicationState.running = false
        })
    }

    /**
     * Saves the last-modified source into its own browser history entries
     */
    saveSource() {
        if (this.applicationState.fullyLoaded) {
            /**
             * @type {SourceObject}
             */
            let object: SourceObject = {
                source: this.state.source,
                ruleLibraries: this.state.libraries,
                async: this.state.async,
                includeWebClasses: this.state.includeWebClasses,
                loadedRule: this.state.loadedRule,
                variables: this.state.variables ?? []
            }

            this.ruleHistoryService.saveSource(object).then(() => {
                // @ts-expect-error
                this.$scope.messages = "Saved source at " + Ext.Date.format(new Date(), 'Y-m-d H:i:s')
                // @ts-expect-error
                this.$scope.messagesPrefix = this.$sce.trustAs(this.$sce.HTML, "<i class='fa fa-check'></i>")
            })
        }
    }

    startSaveRule() {
        if (this.state.loadedRule == null) {
            this.ruleRunnerService.getRuleTypes().then((ruleTypes) => {
                let modalInstance = this.$uibModal.open({
                    animation: true,
                    ariaLabelledBy: 'modal-title',
                    ariaDescribedBy: 'modal-body',
                    templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/modal-name-rule-template.html"),
                    controller: 'RuleNameModalController',
                    controllerAs: '$ctrl',
                    resolve: {
                        state: function () {
                            return {
                                ruleTypes: ruleTypes
                            }
                        }
                    }
                });

                try {
                    modalInstance.result.then((results) => {
                        this.state.loadedRule = new LoadedRule({
                            id: null,
                            name: results.ruleName,
                            type: results.ruleType,
                            libraries: this.state.libraries,
                            async: this.state.async,
                            includeWebClasses: this.state.includeWebClasses,
                            source: this.state.source,
                            description: results.description
                        })
                        this.saveRule()
                    })
                } catch (e) {
                    /* ignore this, just here to avoid errors on throw */
                }
            })
        } else {
            this.saveRule();
        }
    }

    saveRule() {
        if (this.state.loadedRule == null) {
            // Do nothing
            return;
        }
        // Save typing
        this.applicationState.running = true
        this.state.loadedRule.originalSource = this.state.source
        let r = this.state.loadedRule
        this.ruleRunnerService.saveRule(r.id, r.name, r.originalSource, r.type, r.libraries).then((output: any) => {
            if (typeof output === "string" && (output.startsWith("{") || output.startsWith("["))) {
                output = JSON.parse(output)
            }
            if (!("name" in output)) {
                // TODO Handle not found
                console.error("Rule not found??")
            } else {
                // We got one
                this.state.loadedRule = new LoadedRule(output)
            }
            this.applicationState.running = false

            this.eventBus.publish(EventType.SAVED_RULE, {
                id: r.id,
                name: r.name,
                type: r.type,
                libraries: r.libraries,
                originalSource: r.originalSource
            })
        })
    }

    toggleDarkMode() {
        this.eventBus.publish(EventType.DARKMODE, {darkMode: this.darkMode});
    }

    /**
     * Button handler to start the rule running
     */
    runRule() {
        this.runRuleService.runRule(this.state)
    }

    abortRule() {
        if (this.aborting) {
            console.warn("Cannot abort a rule that is already aborting");
            return;
        }
        this.runRuleService.abortRule();
    }

    get aborting() {
        return this.applicationState.aborting ?? false
    }

    get stopButtonDisabled(): boolean {
        let aborting = this.applicationState.aborting
        let lastUpdateObject = this.runRuleService.lastUpdateObject

        // We disable the stop button if:
        // We aren't running a rule
        // We aren't running an async rule
        // We are already aborting a rule
        // The last update object is null or empty (i.e. the initial API call has not returned)
        return !this.applicationState.running || !this.state.async || aborting || nullOrEmpty(lastUpdateObject?.uuid);
    }
}

ruleRunnerModule.component("editorPanel", {
    templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/component/editor/editor.component.html"),
    controller: EditorComponent
});