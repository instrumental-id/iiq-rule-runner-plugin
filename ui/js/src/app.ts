/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {LoadedRule} from "./LoadedRule.js";
import {IQService, ISCEService, IScope, ITimeoutService} from "angular";
import {IAngularStatic} from "angular";
import {AngularScope, UIBModalInstance, Variable} from "./types.js";
import {EditorState, RuleHistoryService, SourceObject} from "./RuleHistoryService.js";
import {RuleRunnerService} from "./RuleRunnerService.js";
import {IPluginHelper} from "./IIQModule.js";
import {RuleVariable} from "./RuleVariable.js";
import {RunningRule} from "./RunningRule.js";
import {ruleRunnerModule} from "./init.js";
import {OutputState} from "./component/output/OutputState.js";

export const PLUGIN_NAME = "IDWRuleRunnerPlugin";
const DARKMODE_SETTING = "idw.rulerunner.darkmode";
const AUTO_HIDE_SETTING = "idw.rulerunner.hidedocumentation";
const GENERATE_VARIABLES_SETTING = "idw.rulerunner.generatevariables";

export const LOG_ERROR = "Error"
export const LOG_WARN = "Warn"
export const LOG_INFO = "Info"
export const LOG_DEBUG = "Debug"

declare var angular: IAngularStatic;

declare var jQuery: any;
declare var PluginHelper: IPluginHelper;
declare var CodeMirror: any;
declare var SailPoint: any;

/**
 * Returns the given value if not empty, or the default value (the first param) if it is empty
 */
ruleRunnerModule.filter('ifEmpty', function() {
	return function(input, defaultValue) {
		if (angular.isUndefined(input) || input === null || input === '') {
			return defaultValue;
		}

		return input;
	}
});

ruleRunnerModule.filter('limit', function () {
    return function (content, length, tail) {
        if (isNaN(length))
            length = 50;
 
        if (tail === undefined)
            tail = "...";
 
        if (content.length <= length || content.length - tail.length <= length) {
            return content;
        }
        else {
            return String(content).substring(0, length-tail.length) + tail;
        }
    };
});

/**
 * Set up the CSRF token to look at the named cookie by default
 */
ruleRunnerModule.config(['$httpProvider', function($httpProvider) {
	$httpProvider.defaults.xsrfCookieName = "CSRF-TOKEN";
}]);

export class RuleRunnerController {
	running: boolean = false;
	fullyLoaded: boolean = false;

	state: EditorState;

	executionHistory: EditorState[]

	loadedRule: LoadedRule | null;

	hideDocumentation: boolean = true;

	darkMode: boolean = false;

	outputState: OutputState

	/**
	 * @param {RuleRunnerService} ruleRunnerService
	 * @param {RuleHistoryService} ruleHistoryService
	 * @param {ISCEService} $sce
	 * @param {IQService} $q
	 * @param {AngularScope & IScope} $scope
	 * @param {ITimeoutService} $timeout
	 * @param $uibModal
	 * @constructor
	 */
	constructor(private ruleRunnerService: RuleRunnerService, private ruleHistoryService: RuleHistoryService, private $sce: ISCEService, private $q: IQService, private $scope: IScope & AngularScope, private $timeout: ITimeoutService, private $uibModal: any) {

		this.state = {
			timeout: 10,
			loadedRule: null,
			source: "",
			async: true,
			includeWebClasses: false,
			isWorkflowRuleLibrary: false,
			suppressRawTypeErrors: false,
			libraries: []
		};

		this.executionHistory = []

		this.loadedRule = null;

		this.outputState = new OutputState();

		this.initializeScope();
		this._initializeController()
	}


	jumpToLine(editor: CodeMirror.Editor, lineNumber: number) {
		// editor.getLineHandle does not help as it does not return the reference of line.
		editor.setCursor(lineNumber);
		this.$timeout(() => {
			editor.addLineClass(lineNumber, "", "center-me");

			let line = jQuery('.CodeMirror-lines .center-me');
			let h = line.parent();

			let scrollElement = jQuery('.CodeMirror-scroll')

			scrollElement.scrollTop(0).scrollTop(line.offset().top - scrollElement.offset().top - Math.round(scrollElement.height()/2));

			editor.removeLineClass(line, "", "center-me");
		}, 200);
	}

	/**
	 * Wipes the run state prior to starting a new run
	 * @private
	 */
	initRunState() {
		this.running = true
		this.outputState.reset()

		this.$scope.logLevel = LOG_DEBUG

		this.$scope.panels = {
			resultselem: true,
			documentationelem: false,
			historyelem: false
		}
	}

	initializeScope() {
		this.$scope.logLevel = LOG_DEBUG
		this.$scope.showingExecutionHistory = false;
		this.$scope.isDocumentationOpen = false;
		this.$scope.generateVariables = true;
		this.$scope.variables = [];

		/**
		 * @type {{documentationelem: boolean, historyelem: boolean, resultselem: boolean}}
		 */
		this.$scope.panels = {
			resultselem: false,
			documentationelem: false,
			historyelem: false
		}

		this.$scope.iiqTemplateMaker = function(tmpl) {
			return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/" + tmpl)
		}

		/**
		 * @type {{flag: boolean}}
		 */
		this.$scope.showRecentOnly = {
			flag: true
		}

		/**
		 * @param {HistoryEntry} row
		 * @return {boolean}
		 */
		this.$scope.filterRecent = (row: EditorState) => {
			if (this.$scope.showRecentOnly.flag) {
				let cutoff = new Date()
				cutoff.setMonth(cutoff.getMonth() - 1)

				let rowDate: Date | null = null;
				if (row.timestamp && row.timestamp > 0) {
					rowDate = new Date(row.timestamp)
				} else if (row.date) {
					rowDate = new Date(row.date)
				}
				if (rowDate !== null) {
					return (rowDate > cutoff)
				}
			}
			return true;
		}

	}

	/**
	 * Restores the variables stored in the given HistoryEntry
	 *
	 * @param {EditorState} history
	 */
	restoreHistory(history: EditorState) {
		if (history === undefined || !("source" in history)) {
			throw "You cannot restore an undefined or empty history"
		}
		this.state = {
			timeout: 10,
			source: history.source,
			libraries: history.libraries,
			loadedRule: history.loadedRule ? new LoadedRule(history.loadedRule) : null,
			includeWebClasses: history.includeWebClasses ?? false,
			async: history.async ?? true,
			isWorkflowRuleLibrary: history.isWorkflowRuleLibrary ?? false,
			suppressRawTypeErrors: history.suppressRawTypeErrors ?? false,
		};

		if (this.$scope.ruleLibrarySelectize) {
            this.$scope.ruleLibrarySelectize('clear');
            history.libraries.forEach((item) => {
                this.$scope.ruleLibrarySelectize?.('addItem', item.title)
            })
        }
	}

	/**
	 * Toggles the execution history accordion
	 */
	showExecutionHistory() {
		if (this.$scope.showingExecutionHistory) {
			this.$scope.showingExecutionHistory = false
		} else {
			this.ruleHistoryService.getOrBootstrapExecutionHistory(true).then((history) => {
				this.executionHistory = history;
				this.$scope.showingExecutionHistory = true;
			})
		}
	}

	/**
	 * Saves the last-modified source into its own browser history entries
	 */
	saveSource() {
	    if (this.fullyLoaded) {
			/**
			 * @type {SourceObject}
			 */
			let object: SourceObject = {
	    		source: this.state.source,
				ruleLibraries: this.state.libraries,
				async: this.state.async,
				includeWebClasses: this.state.includeWebClasses,
				loadedRule: this.state.loadedRule
			}

			this.ruleHistoryService.saveSource(object).then(() => {
				// @ts-ignore
				this.$scope.messages = "Saved source at " + Ext.Date.format(new Date(), 'Y-m-d H:i:s')
				// @ts-ignore
				this.$scope.messagesPrefix = this.$sce.trustAs(this.$sce.HTML, "<i class='fa fa-check'></i>")
			})
        }
	}

	/**
	 * Saves the next round of execution history into browser local storage
	 */
	async saveHistory() {
		this.executionHistory = await this.ruleHistoryService.saveHistory(this.state)
	}

	clearRule() {
	    this.loadedRule = null;
		let fakeHistory: EditorState = {
	        source: "",
	        libraries: [],
			async: true,
			includeWebClasses: false,
			isWorkflowRuleLibrary: false,
			suppressRawTypeErrors: false,
			loadedRule: null,
			timeout: 10
	    }
	    this.restoreHistory(fakeHistory)
	}

	startSaveRule() {
	    if (this.loadedRule == null) {
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
						this.loadedRule = new LoadedRule({
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
	    if (this.loadedRule == null) {
	        // Do nothing
			return;
	    }
	    // Save typing
	    this.running = true
	    this.loadedRule.originalSource = this.state.source
	    let r = this.loadedRule
		this.ruleRunnerService.saveRule(r.id, r.name, r.originalSource, r.type, r.libraries).then((output: any) => {
            if (typeof output === "string" && (output.startsWith("{") || output.startsWith("["))) {
                output = JSON.parse(output)
            }
            if (!("name" in output)) {
                // TODO Handle not found
				console.error("Rule not found??")
            } else {
                // We got one
                this.loadedRule = new LoadedRule(output)
            }
	        this.running = false
	    })
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

	loadRule(name: string) {
	    this.running = true;
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
				for(let i = this.$scope.variables.length - 1; i >= 0; i--) {
					console.log(this.$scope.variables[i]);
					if (this.$scope.variables[i].provided) {
						console.log("removing variable");
						this.$scope.variables.splice(i, 1);
					}
				}

				this.loadedRule = new LoadedRule(output)
				console.log("Loaded rule output: ");
				console.log(output);
				/**
				 * @type {EditorState}
				 */
				let fakeHistory: EditorState = {
					source: this.loadedRule.originalSource ?? "",
					libraries: this.loadedRule.getSelectizeLibraries(),
					async: true,
					includeWebClasses: false,
					loadedRule: this.loadedRule,
					isWorkflowRuleLibrary: false,
					suppressRawTypeErrors: false,
					timeout: 10
				}
				
				// Auto add found variables to loaded rule 
				try {
					if(this.$scope.generateVariables) {
						console.log("Generating variables")
						Object.entries(output["variables"]).forEach(([key, value]) => {
							console.log(`${key} ${value}`);
							let options = {
								"provided": true,
								"name": key,
								"type": value
							}
							let ruleVariable = new RuleVariable(options);
							this.$scope.variables.push(ruleVariable);
						});
					}
					else{
						console.log("Not generating variables")
					}
					
				} catch (error) {
					console.log("Error adding variables to loaded rule: " + error);
				}
				
				console.log(this.$scope.variables);

				this.restoreHistory(fakeHistory)
			}
			this.running = false
		})
	}

	/**
	 * Scrolls the CodeMirror element to a particular error
	 * @param {!number} errorNumber
	 */
	scrollToError(errorNumber) {
		if (this.fullyLoaded) {
			let errors = this.$scope.errors;
			if (errors) {
				let error = errors[errorNumber];
				if (error) {
					this.jumpToLine(this.$scope.codeMirror, error._line)
				}
				this.$scope.nextErrorItem = errorNumber + 1
				if (this.$scope.nextErrorItem >= errors.length) {
					this.$scope.nextErrorItem = 0;
				}
			}
		}
	}

	/**
	 * Force a lint to go ahead by modifying the options
	 */
	parseRule() {
		this.$scope.codeMirror?.setOption("lint",
			{
				"getAnnotations": this.javaCheck.bind(this),
				"async" : true
			}
		)
	}

	checkStatus(uuid: string) {
		if (this.running) {
			this.ruleRunnerService.checkStatus(uuid, this.$scope.logLevel).then((output: any) => {
				let runningRule = new RunningRule(output);
				runningRule.handleOutput(this.saveHistory.bind(this), this.outputState).then(() => {
					this.$scope.$apply()
				})
				if (!runningRule.isDone()) {
					if (!runningRule.uuid) {
						console.error("Recieved output without a UUID??", runningRule)
					} else {
						const nextUuid = runningRule.uuid;
						this.$timeout(() => {
							this.checkStatus(nextUuid)
						}, 2000)
					}
				} else {
					this.running = false;
				}
			})
		}
	}

	abortRule() {
		if (this.running && this.outputState.lastUpdateObject && "uuid" in this.outputState.lastUpdateObject) {
			let uuid = this.outputState.lastUpdateObject.uuid
			console.debug("Aborting running rule with UUID " + uuid)
			this.outputState.aborting = true

			this.ruleRunnerService.asyncAbort(uuid).then((output: any) => {
				let runningRule = new RunningRule(output);
				runningRule.handleOutput(this.saveHistory.bind(this), this.outputState).then(() => {
					this.outputState.aborting = false
					this.outputState.lastAbortTime = new Date()
					this.$scope.$apply()
				})
				this.running = false;
			})
		}
	}

	/**
	 * Invokes the rule
	 * @return {Promise<RunningRule|null>}
	 */
	async runRule(): Promise<RunningRule|null> {
		if (this.state.source.trim() === "") {
			return null
		}

		this.initRunState()

		this.saveSource();

		console.debug("Variables list: ", this.$scope.variables);

		this.$scope.panels.resultselem = true;

		return this.ruleRunnerService.runRule(this.state.source ?? "", this.state.libraries, this.$scope.variables ?? [], this.state.includeWebClasses ?? false, this.state.async ?? true, this.state.timeout ?? 10).then((output: any) => {
			let runningRule = new RunningRule(output);

			runningRule.handleOutput(this.saveHistory.bind(this), this.outputState).then(() => {
				this.$scope.$apply()
			})

			if (runningRule.isAsync()) {
				if (!runningRule.isDone()) {
					const uuid: string = runningRule.uuid ?? "";
					this.$timeout( () => {
						this.checkStatus(uuid)
					}, 2000)
				} else {
					this.running = false;
				}
			} else {
				this.running = false;
			}

			if(this.hideDocumentation){
				this.$scope.panels.documentationelem = false;
			}

			return runningRule
		})
	}

	/**
	 * This is invoked by CodeMirror when a lint operation is triggered. It is expected to read
	 * any errors from some data source, then invoke the updateLinting function with the results
	 * once they are available.
	 *
	 * Note that this is expecting CodeMirror 4, which is the version included with IIQ. The
	 * parameters passed here are somewhat different in CodeMirror 5.
	 *
	 * @param {CodeMirror} cm
	 * @param {function(CodeMirror, *[]): void} updateLinting
	 */
	javaCheck(cm, updateLinting) {
		let variables: Variable[] | null = null
		if (this.loadedRule && this.loadedRule.variables) {
			variables = this.loadedRule.variables
		}

		let source = cm.getValue()

		this.ruleRunnerService.parseRule(source, this.state.libraries, this.state.includeWebClasses, this.state.isWorkflowRuleLibrary, this.state.suppressRawTypeErrors, this.$scope.variables).then((data) => {
			let found: any[] = [];
			for(let item of data) {
				if (item.line != null) {
					found.push({
						message: item.message,
						from: CodeMirror.Pos(item.line, item.start),
						to: CodeMirror.Pos(item.line, item.end + 1),
						severity: "error",
						_line: item.line
					})
				}
			}
			this.$scope.errors = found;
			this.$scope.errorCount = found.length;
			if (this.$scope.nextErrorItem >= this.$scope.errors.length) {
				this.$scope.nextErrorItem = 0;
			}
			updateLinting(cm, found)
		});
	}

	toggleDarkMode() {
		if (this.$scope.codeMirror !== undefined) {
			console.log("Setting dark mode to " + this.darkMode);
			if (this.darkMode === true) {
				this.$scope.codeMirror.setOption("theme", "vibrant-ink")
				jQuery(".sp-body").addClass("dark");
				jQuery(".sp-body-container").addClass("dark");
			} else {
				this.$scope.codeMirror.setOption("theme", "sailpoint");
				jQuery(".sp-body").removeClass("dark");
				jQuery(".sp-body-container").removeClass("dark");
			}
			localStorage.setItem(DARKMODE_SETTING, String(this.darkMode));
		}
	}
	
	toggleAutoHide() {
		localStorage.setItem(AUTO_HIDE_SETTING, String(this.hideDocumentation));
	}
	
	 toggleDocumentation() {
			// This conditional accounts for if you have just executed code and don't feel like waiting for auto re-open 
			if(this.$scope.isDocumentationOpen && this.$scope.panels.documentationelem && this.hideDocumentation){
				console.log("documentation was already open, leaving this.isDocumentationOpen as is");
			} else {
				this.$scope.isDocumentationOpen = !this.$scope.isDocumentationOpen;
			}
		
		console.log("documentation has been opened/closed");
	}
		
	reopenDocumentation(){
		console.log("reopening documentation");
		if (this.hideDocumentation){
			this.$scope.panels.documentationelem = this.$scope.isDocumentationOpen;
		}
	}

	toggleGenerateVariables() {
		console.log("Setting generate variables to " + this.$scope.generateVariables)
		localStorage.setItem(GENERATE_VARIABLES_SETTING, String(this.$scope.generateVariables));
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
						variables: this.$scope.variables
					}
				}
			}
		});

		modalInstance.result.then((output) => {
			if (output.variables) {
				this.$scope.variables = output.variables
			}
		})
	}

	_initializeController() {
		CodeMirror.commands.autocomplete = function (cm) {
			cm.showHint(
				{
					hint: CodeMirror.hint.anyword
				}
			);
		}

		this.$scope.$watch("ctrl.source", () => {
			this.saveSource()
		});

		this.$scope.$watch("ctrl.ruleLibraries", () => {
			this.saveSource();
			this.parseRule();
		});

		this.$scope.$watch("ctrl.includeWebClasses", () => {
			this.parseRule();
			this.saveSource();
		})

		this.$scope.$watch("ctrl.isWorkflowRuleLibrary", () => {
			this.parseRule();
			this.saveSource();
		})

		this.$scope.$watch("ctrl.suppressRawTypeErrors", () => {
			this.parseRule();
			this.saveSource();
		})

		this.$scope.$watch("ctrl.loadedRule", () => {
			this.saveSource();
		});

		this.$scope.nextErrorItem = 0;

		this.$scope.resultselem = {
			open: false
		}

		this.$scope.historyelem = {
			open: false
		}

		this.$scope.documentationelem = {
			open: false
		}

		this.$scope.selectizeOptions = {
			maxItems: 10,
			searchField: ['title'],
			searchConjunction: 'and',
			valueField: 'title',
			labelField: 'title'
		}

		/**
		 * This is the input to the CodeMirror object.
		 *
		 * @type {Object.<string, any>}
		 */
		this.$scope.editorOptions = {
			lineNumbers: true,
			mode: 'text/x-java',
			readOnly: false,
			theme: 'sailpoint',
			extraKeys: {"Ctrl-Space": "autocomplete"},
			matchBrackets: true,
			autoCloseBrackets: true,
			styleActiveLine: true,
			gutters: ["CodeMirror-lint-markers"],
			lint: {
				"getAnnotations": this.javaCheck.bind(this),
				"async": true,
			},
		};

		/**
		 * CodeMirror onLoad as set up in the CodeMirror-UI element
		 * @param {CodeMirror} cm
		 */
		this.$scope.onCodeMirrorLoad = (cm) => {
			this.$scope.codeMirror = cm;
			this.toggleDarkMode()
			this.toggleAutoHide()
		}

		let prevDarkMode = localStorage.getItem(DARKMODE_SETTING) || "false"

		let prevHideDocumentation = localStorage.getItem(AUTO_HIDE_SETTING) || "true"

		let prevGenerateVariables = localStorage.getItem(GENERATE_VARIABLES_SETTING) || "true"

		this.darkMode = (prevDarkMode === "true");

		this.hideDocumentation = (prevHideDocumentation === "true");

		this.$scope.generateVariables = (prevGenerateVariables === "true");

		this.$scope.$watch("ctrl.darkMode", () => {
			this.toggleDarkMode()
		});

		this.$scope.$watch("ctrl.hideDocumentation", () => {
			this.toggleAutoHide();
		});

		this.$scope.$watch("generateVariables", () => {
			this.toggleGenerateVariables();
		});

		this.$timeout(async () => {
			this.executionHistory = await this.ruleHistoryService.getOrBootstrapExecutionHistory(true);

			/**
			 * @type {{libraries: SelectizeLibrary[], source: string, loadedRule: ?LoadedRule, async: boolean}}
			 */
			let lastEntry = await this.ruleHistoryService.getLastSource()

			if (lastEntry.source) {
				this.state.source = lastEntry.source;
			}

			if (lastEntry.loadedRule) {
				let parsed = lastEntry.loadedRule
				if (parsed != null && parsed.name != null) {
					this.loadedRule = new LoadedRule(parsed)
				}
			}

			this.state.async = lastEntry.async

			this.ruleRunnerService.getRuleLibraries().then(async (data: any) => {
				let options: any[] = []
				data.forEach((ruleName) => {
					options.push({
						id: ruleName,
						title: ruleName
					})
				});
				this.$scope.ruleLibraryOptions = options;

				let lastEntry = await this.ruleHistoryService.getLastSource()
				let lastLibs = lastEntry.libraries || []

				let _initRuleLibraries =
					() => {
						if (lastLibs.length > 0) {
							this.state.libraries = lastLibs
							this.state.libraries.forEach((item) => {
								this.$scope.ruleLibrarySelectize?.('addItem', item.title)
							})
						}
						this.fullyLoaded = true;
					}

				this.$timeout(_initRuleLibraries, 500);
			});
		}, 0)

		this.$scope.documentationLink = SailPoint.CONTEXT_PATH + "/doc/javadoc";
	}
}

/**
 * The AngularJS controller for this application
 */
ruleRunnerModule.controller('RuleRunnerController', RuleRunnerController)

/**
 * The controller for the pop-up modal for export to CSV (and possibly other formats later)
 * @param {RuleRunnerService} ruleRunnerService
 * @param this.$scope
 * @param $uibModalInstance The modal instance
 * @param {object} state The initial modal state
 * @returns
 * @ngInject
 *
 * @typedef RuleSelectionItem
 * @property {string} name
 * @property {string} type
 */
function RuleSelectionModalController(this: any, ruleRunnerService, $scope, $uibModalInstance: UIBModalInstance, state) {
    let me = this

	/**
	 * @type {RuleSelectionItem[]}
	 */
    $scope.rulesTable = []

    ruleRunnerService.getRulesList("").then(
    	(output: any) => {
			if (typeof output === "object") {
				for(let rule in output) {
					if (output.hasOwnProperty(rule)) {
						let type = output[rule]
						$scope.rulesTable.push(
							{
								name: rule,
								type: type
							}
						)
					}
				}
			}
    	}
    )

	/**
	 * @param {RuleSelectionItem} item
	 */
    this.selectItem = (item) => {
        $uibModalInstance.close(item);
    }
}
ruleRunnerModule.controller('RuleSelectionModalController', RuleSelectionModalController);

/**
 * The controller for the pop-up modal for export to CSV (and possibly other formats later)
 * @param {RuleRunnerService} ruleRunnerService
 * @param this.$scope
 * @param $uibModalInstance The modal instance
 * @param state The initial modal state
 * @returns
 * @ngInject
 */
function RuleNameModalController(this: any, ruleRunnerService, $scope, $uibModalInstance, state) {
    let me = this

	console.debug("Input state for the rule name modal", state)

    $scope.ruleName = state.ruleName
    $scope.ruleType = state.ruleType
	$scope.ruleTypes = state.ruleTypes

	$scope.ruleNameFilter = ""

	/**
	 * This is the input to the CodeMirror object.
	 *
	 * @type {Object.<string, any>}
	 */
	$scope.editorOptions = {
		lineNumbers: false,
		mode: 'text/x-java',
		readOnly: false,
		theme: 'sailpoint',
		extraKeys: {"Ctrl-Space": "autocomplete"},
		matchBrackets: true,
		autoCloseBrackets: true,
		styleActiveLine: true
	};

    this.ok = () => {
        let result = {
            ruleName: $scope.ruleName,
            ruleType: $scope.ruleType
        }
        $uibModalInstance.close(result);
    }
	this.cancel = () => {
		$uibModalInstance.dismiss('cancel');
	};
}
ruleRunnerModule.controller('RuleNameModalController', RuleNameModalController);

