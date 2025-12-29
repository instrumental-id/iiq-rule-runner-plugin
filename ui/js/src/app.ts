/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {ruleRunnerModule} from "./IIQModule";

import {IQService, ISCEService, IScope, ITimeoutService} from "angular";
import {IAngularStatic} from "angular";
import {AngularScope, LogLevel, UIBModalInstance, Variable} from "./types";
import {RuleRunnerService} from "./services/RuleRunnerService";
import {RuleHistoryService, SourceObject} from "./services/RuleHistoryService";
import {IPluginHelper} from "./IIQModule";
import {EditorState} from "./model/EditorState";
import {ApplicationState} from "./ApplicationState";
import {
	EventBus, EventType
} from "./services/EventBus";
import {EditorComponent} from "./component/editor/editor.component";

export const PLUGIN_NAME = "IDWRuleRunnerPlugin";
export const DARKMODE_SETTING = "idw.rulerunner.darkmode";
export const AUTO_HIDE_SETTING = "idw.rulerunner.hidedocumentation";
export const GENERATE_VARIABLES_SETTING = "idw.rulerunner.generatevariables";

export const LOG_ERROR: LogLevel = "Error"
export const LOG_WARN: LogLevel = "Warn"
export const LOG_INFO: LogLevel = "Info"
export const LOG_DEBUG: LogLevel = "Debug"

declare var angular: IAngularStatic;

declare var PluginHelper: IPluginHelper;
declare var SailPoint: any;

ruleRunnerModule.directive("selectNgFiles", function() {
    return {
        require: "ngModel",
        link: function postLink(scope,elem,attrs,ngModel) {
            elem.on("change", function(e) {
                // @ts-ignore
                const files = elem[0].files;
                ngModel?.$setViewValue(files);
            })
        }
    }
});

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

	source: string = "";

	editorComponent: EditorComponent | null = null;

	/**
	 * @param {RuleRunnerService} ruleRunnerService
	 * @param {RuleHistoryService} ruleHistoryService
	 * @param {ISCEService} $sce
	 * @param {IQService} $q
	 * @param {AngularScope & IScope} $scope
	 * @param {ITimeoutService} $timeout
	 * @param $uibModal
	 * @param {ApplicationState} applicationState
	 * @constructor
	 */
	constructor(private ruleRunnerService: RuleRunnerService, private ruleHistoryService: RuleHistoryService, private $sce: ISCEService, private $q: IQService, private $scope: IScope & AngularScope, private $timeout: ITimeoutService, private $uibModal: any, private applicationState: ApplicationState, private eventBus: EventBus) {
		this.initializeScope();
		this._initializeController()

		this.eventBus.register(EventType.REGISTER_EDITOR, (args: { editor: EditorComponent }) => {
			this.editorComponent = args.editor;
		});
	}

	/**
	 * Wipes the run state prior to starting a new run
	 * @private
	 */
	initRunState() {
		this.applicationState.running = true

		this.applicationState.panels = {
			resultselem: true,
			documentationelem: false,
			historyelem: false
		}
	}

	initializeScope() {
		this.applicationState.generateVariables = true;

		/**
		 * @type {{documentationelem: boolean, historyelem: boolean, resultselem: boolean}}
		 */
		this.applicationState.closeAll()

		this.$scope.iiqTemplateMaker = (tmpl) => {
			return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/" + tmpl)
		}

		/**
		 * @type {{flag: boolean}}
		 */
		this.applicationState.showRecentOnly = true

		/**
		 * @param {EditorState} row
		 * @return {boolean}
		 */
		this.$scope.filterRecent = (row: EditorState): boolean => {
			if (this.applicationState.showRecentOnly) {
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

	toggleAutoHide() {
		localStorage.setItem(AUTO_HIDE_SETTING, String(this.applicationState.hideDocumentation));
	}
	
	toggleDocumentation() {
		// This conditional accounts for if you have just executed code and don't feel like waiting for auto re-open
		if(this.applicationState.isDocumentationOpen && this.applicationState.panels.documentationelem && this.applicationState.hideDocumentation){
			console.log("documentation was already open, leaving this.isDocumentationOpen as is");
		} else {
			this.applicationState.isDocumentationOpen = !this.applicationState.isDocumentationOpen;
		}
		
		console.log("documentation has been opened/closed");
	}

	reopenDocumentation(){
		console.log("reopening documentation");
		if (this.applicationState.hideDocumentation){
			this.applicationState.panels.documentationelem = this.applicationState.isDocumentationOpen;
		}
	}

	restoreHistory(row) {
		this.eventBus.publish(EventType.RESTORE_HISTORY, row);
	}

	_initializeController() {
		this.eventBus.register(EventType.EDITOR_READY, () => {
			this.toggleAutoHide()
		})

		this.eventBus.register(EventType.STARTING_RULE_RUN, () => {
			this.initRunState()

			if (this.applicationState.hideDocumentation) {
				this.applicationState.panels.documentationelem = false;
			}
		})

		this.eventBus.register(EventType.FINISHED_RULE_RUN, () => {
			this.reopenDocumentation()
			this.applicationState.running = false;
		})

		this.$timeout(async () => {
			this.applicationState.executionHistory = await this.ruleHistoryService.getOrBootstrapExecutionHistory(true);
			console.debug("INIT: Loaded " + this.applicationState.executionHistory.length + " execution history items");
		}, 0)

		let prevHideDocumentation = localStorage.getItem(AUTO_HIDE_SETTING) || "true"

		let prevGenerateVariables = localStorage.getItem(GENERATE_VARIABLES_SETTING) || "true"

		this.applicationState.hideDocumentation = (prevHideDocumentation === "true");

		this.applicationState.generateVariables = (prevGenerateVariables === "true");

		this.$scope.$watch("ctrl.applicationState.hideDocumentation", () => {
			this.toggleAutoHide();
		});

		this.$scope.$watch("ctrl.applicationState.generateVariables", () => {
			this.eventBus.publish(EventType.EDITOR_GENERATE_VARIABLES, {
				generateVariables: this.applicationState.generateVariables
			});
		});

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

