
/**
 * Angular module to implement rule running
 * https://www.identityworksllc.com
 */
const ruleRunnerModule = angular.module('RuleRunnerPluginModule',  ['ngSanitize', 'ui.bootstrap', 'ui.codemirror', 'jsonFormatter', 'prettyXml', 'selectize']);

const PLUGIN_NAME = "IDWRuleRunnerPlugin";
const DARKMODE_SETTING = "idw.rulerunner.darkmode";
const EXECUTION_HISTORY_ENTRY = "idw.rulerunner.executionhistory";
const LAST_SOURCE_ENTRY = "idw.rulerunner.last";
const AUTO_HIDE_SETTING = "idw.rulerunner.hidedocumentation";
const GENERATE_VARIABLES_SETTING = "idw.rulerunner.generatevariables";

const LOG_ERROR = "Error"
const LOG_WARN = "Warn"
const LOG_INFO = "Info"
const LOG_DEBUG = "Debug"

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

/**
 * @param {RuleRunnerService} ruleRunnerService
 * @param $sce
 * @param $q
 * @param $scope
 * @param {angular.$interpolate} $interpolate
 * @param {function(function(*), number)} $timeout
 * @param $uibModal
 * @constructor
 */
function RuleRunnerController(ruleRunnerService, $sce, $q, $scope, $interpolate, $timeout, $uibModal) {

	const EMPTY_HISTORY_STRING = "[]"

	let me = this;

	let $ = jQuery;

	/**
	 * @param {boolean} allowLoad True if we want to allow loading from the server (pass false from the load itself to avoid a recursive loop)
	 * @return {string} The execution history (or a new [])
	 */
	function getOrBootstrapExecutionHistory(allowLoad) {
		let storedHistory = localStorage.getItem(EXECUTION_HISTORY_ENTRY)
		if (storedHistory == null && allowLoad) {
			$timeout(() => {
				me.loadServerHistory()
			}, 0)
		}
		return storedHistory || EMPTY_HISTORY_STRING
	}

	/**
	 * @return {HistoryEntry}
	 */
	function getLastSource() {
		let lastSourceString = localStorage.getItem(LAST_SOURCE_ENTRY)
		if (lastSourceString) {
			return JSON.parse(lastSourceString)
		} else {
			return {
				source: null,
				libraries: null,
				loadedRule: null,
				async: true,
				includeWebClasses: false
			}
		}
	}

	/**
	 * @param editor {CodeMirror}
	 * @param lineNumber {!number}
	 */
	function jumpToLine(editor, lineNumber) {
		// editor.getLineHandle does not help as it does not return the reference of line.
		editor.setCursor(lineNumber);
		$timeout(() => {
			editor.addLineClass(lineNumber, null, "center-me");

			let line = $('.CodeMirror-lines .center-me');
			let h = line.parent();

			let scrollElement = $('.CodeMirror-scroll')

			scrollElement.scrollTop(0).scrollTop(line.offset().top - scrollElement.offset().top - Math.round(scrollElement.height()/2));

			editor.removeLineClass(line, null, "center-me");
		}, 200);
	}

	/**
	 * Wipes the run state prior to starting a new run
	 * @private
	 */
	function initRunState() {
		me.running = true
		$scope.logs = []
		$scope.aborting = false
		$scope.lastAbortTime = null;
		$scope.lastUpdateObject = null
		$scope.lastUpdate = null
		$scope.errorMessage = null
		$scope.output = null
		$scope.json = null
		$scope.xml = null
		$scope.hostname = null
		$scope.runningRuleStats = null
		$scope.logLevel = LOG_DEBUG
	}

	/**
	 * @type {{documentationelem: boolean, historyelem: boolean, resultselem: boolean}}
	 */
	$scope.panels = {
		resultselem: false,
		documentationelem: false,
		historyelem: false
	}

	$scope.iiqTemplateMaker = function(tmpl) {
		return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/" + tmpl)
	}

	/**
	 * @type {{flag: boolean}}
	 */
	$scope.showRecentOnly = {
		flag: true
	}

	/**
	 * @param {HistoryEntry} row
	 * @return {boolean}
	 */
	$scope.filterRecent = function(row) {
		if ($scope.showRecentOnly.flag) {
			let cutoff = new Date()
			cutoff.setMonth(cutoff.getMonth() - 1)

			/**
			 * @type {null|Date}
			 */
			let rowDate = null;
			if (row.timestamp > 0) {
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

	/**
	 * @type {string}
	 */
	me.source = "";

	/**
	 * @type {SelectizeLibrary[]}
	 */
	me.ruleLibraries = []

	/**
	 * @type {?LoadedRule}
	 */
	me.loadedRule = null;

	/**
	 * @type {boolean}
	 */
	me.running = false

	/**
	 * @type {boolean}
	 */
	me.fullyLoaded = false;

	/**
	 * @type {HistoryEntry[]}
	 */
	me.executionHistory = JSON.parse(getOrBootstrapExecutionHistory(true));
	
	me.showingExecutionHistory = false
	
	me.ruleLibrarySelectize = undefined

	me.includeWebClasses = false

	me.isWorkflowRuleLibrary = false;

	me.suppressRawTypeErrors = false;

	me.async = true;
	
	me.isDocumentationOpen = false;

	me.generateVariables = true;

	/**
	 * @type {RuleVariable[]}
	 */
	me.variables = []

	/**
	 * Restores the variables stored in the given HistoryEntry
	 *
	 * @param {HistoryEntry} history
	 */
	me.restoreHistory = function(history) {
		if (history === undefined || !("source" in history)) {
			throw "You cannot restore an undefined or empty history"
		}
		me.includeWebClasses = false
		me.isWorkflowRuleLibrary = false;
		me.suppressRawTypeErrors = false;
		me.async = true;
		me.source = ""

		me.source = history.source
		if (me.ruleLibrarySelectize) {
            me.ruleLibrarySelectize('clear');
            history.libraries.forEach(function(item) {
                me.ruleLibrarySelectize('addItem', item.title)
            })
        }
        if (history.loadedRule) {
            me.loadedRule = new LoadedRule(history.loadedRule.id, history.loadedRule.name, history.loadedRule.type, history.loadedRule.libraries, history.loadedRule.originalSource, history.loadedRule.description, history.loadedRule.variables)
        }
        if (history.includeWebClasses) {
        	me.includeWebClasses = true;
		}
        if (history.isWorkflowRuleLibrary) {
        	me.isWorkflowRuleLibrary = true;
		}
        if (history.suppressRawTypeErrors) {
        	me.suppressRawTypeErrors = true;
		}

        if ("async" in history && !history.async) {
        	me.async = false
		}
	}

	/**
	 * Toggles the execution history accordion
	 */
	me.showExecutionHistory = function() {
		if (me.showingExecutionHistory) {
			me.showingExecutionHistory = false
		} else {
			let historyStr = getOrBootstrapExecutionHistory(true)
			me.executionHistory = JSON.parse(historyStr)
			me.showingExecutionHistory = true
		}
	}

	/**
	 * Saves the last-modified source into its own browser history entries
	 */
	me.saveSource = function() {
	    if (me.fullyLoaded) {
			/**
			 * @type {{libraries: SelectizeLibrary[], source: string, loadedRule: ?LoadedRule}}
			 */
			let object = {
	    		source: me.source,
				libraries: me.ruleLibraries,
				async: me.async,
				includeWebClasses: me.includeWebClasses,
				loadedRule: me.loadedRule
			}

			localStorage.setItem(LAST_SOURCE_ENTRY, JSON.stringify(object))

            $scope.messages = "Saved source at " + Ext.Date.format(new Date(), 'Y-m-d H:i:s')
            $scope.messagesPrefix = $sce.trustAs($sce.HTML, "<i class='fa fa-check'></i>")
        }
	}

	/**
	 * Saves the next round of execution history into browser local storage
	 */
	me.saveHistory = function() {
		let historyStr = getOrBootstrapExecutionHistory(false)

		/**
		 * @type {HistoryEntry[]}
		 */
		let history = JSON.parse(historyStr)

		let now = new Date()

		/**
		 * @type {HistoryEntry}
		 */
		let execution = {
			timestamp: now.getTime(),
			date: now.toISOString(),
			source: me.source,
			libraries: me.ruleLibraries || [],
			loadedRule: me.loadedRule,
			includeWebClasses: me.includeWebClasses || false,
			suppressRawTypeErrors: me.suppressRawTypeErrors || false,
			isWorkflowRuleLibrary : me.isWorkflowRuleLibrary || false,
			async: me.async || false
		}

		let foundIndex;
		do {
			foundIndex = -1;
			for(let index in history) {
				let historyItem = history[index]
				if (historyItem.source === execution.source && JSON.stringify(historyItem.libraries.sort()) === JSON.stringify(execution.libraries.sort())) {
					foundIndex = index;
					break;
				}
			}
			
			if (foundIndex >= 0) {
				history.splice(foundIndex, 1)
			}
		} while(foundIndex >= 0);
		
		history.push(execution)

		localStorage.setItem(EXECUTION_HISTORY_ENTRY, JSON.stringify(history))
		
		me.executionHistory = history
	}

	/**
	 * Repopulates the locally stored history by merging it with the audit history from the server
	 */
	me.loadServerHistory = function() {
		let historyStr = getOrBootstrapExecutionHistory(false)

		/**
		 * @type {HistoryEntry[]}
		 */
		let history = JSON.parse(historyStr)

		ruleRunnerService.getMyHistory().then((json) => {

			for(let row of json) {
				let date = new Date(row.timestamp)
				let libraries = row.libraries || []
				/**
				 * @type {HistoryEntry}
				 */
				let execution = {
					timestamp: date.getTime(),
					date: date.toISOString(),
					source: row.source,
					libraries: libraries.map((item) => { return { title: item } }),
					loadedRule: null,
					includeWebClasses: row.includeWebClasses,
					suppressRawTypeErrors: false,
					isWorkflowRuleLibrary: false,
					async: true
				}

				let foundIndex;
				do {
					foundIndex = -1;
					for (let index in history) {
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

				localStorage.setItem(EXECUTION_HISTORY_ENTRY, JSON.stringify(history))

				me.executionHistory = history
			}
		})

	}

	me.clearRule = function() {
	    me.loadedRule = null;
		/**
		 * @type {HistoryEntry}
		 */
		let fakeHistory = {
	        source: "",
	        libraries: []
	    }
	    me.restoreHistory(fakeHistory)
	}

	me.startSaveRule = function() {
	    if (me.loadedRule == null) {
			ruleRunnerService.getRuleTypes().then((ruleTypes) => {
				let modalInstance = $uibModal.open({
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
						me.loadedRule = new LoadedRule(null, results.ruleName, results.ruleType, me.ruleLibraries, me.source, results.description)
						me.saveRule()
					})
				} catch (e) {
					/* ignore this, just here to avoid errors on throw */
				}
			})
	    } else {
	    	me.saveRule();
		}
	}

	me.saveRule = function() {
	    if (me.loadedRule == null) {
	        // Do nothing
	    }
	    // Save typing
	    me.running = true
	    me.loadedRule.originalSource = me.source
	    let r = me.loadedRule
		ruleRunnerService.saveRule(r.id, r.name, r.originalSource, r.type, r.libraries).then(function(output) {
            if (typeof output === "string" && (output.startsWith("{") || output.startsWith("["))) {
                output = JSON.parse(output)
            }
            if (!output["name"]) {
                // TODO Handle not found
				console.error("Rule not found??")
            } else {
                // We got one
                me.loadedRule = new LoadedRule(output["id"], output["name"], output["type"], output["libraries"], output["source"], output["description"], output["variables"])
            }
	        me.running = false
	    })
	}

	/**
	 * Starts the process of loading a rule
	 */
	me.startLoadRule = function() {
		ruleRunnerService.getRuleTypes().then((ruleTypes) => {
			let modalInstance = $uibModal.open({
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
						me.loadRule(name)
					}
				}
			})
		})
	}

	me.loadRule = function(name) {
	    me.running = true;
	    ruleRunnerService.loadRule(name).then((output) => {
			if (typeof output === "string" && (output.startsWith("{") || output.startsWith("["))) {
				output = JSON.parse(output)
			}
			if (!output["name"]) {
				throw "Rule " + name + " not found"
			} else {
				// We got one

				// On load remove any auto added variables
				console.log("checking for variables to remove");
				for(var i = me.variables.length - 1; i >= 0; i--) {
					console.log(me.variables[i]);
					if (me.variables[i]["provided"]) {
						console.log("removing variable");
						me.variables.splice(i, 1);
					}
				}

				me.loadedRule = new LoadedRule(output["id"], output["name"], output["type"], output["libraries"], output["source"], null, output["variables"])
				console.log("Loaded rule output: ");
				console.log(output);
				/**
				 * @type {HistoryEntry}
				 */
				let fakeHistory = {
					source: me.loadedRule.originalSource,
					libraries: me.loadedRule.getSelectizeLibraries()
				}
				
				// Auto add found variables to loaded rule 
				try {
					if(me.generateVariables){
						console.log("Generating variables")
						Object.entries(output["variables"]).forEach(([key, value]) => {
							console.log(`${key} ${value}`);
							let options = {
								"provided": true,
								"name": key,
								"type": value
							}
							let ruleVariable = new RuleVariable(options);
							me.variables.push(ruleVariable);
						});
					}
					else{
						console.log("Not generating variables")
					}
					
				} catch (error) {
					console.log("Error adding variables to loaded rule: " + error);
				}
				
				console.log(me.variables);

				me.restoreHistory(fakeHistory)
			}
			me.running = false
		})
	}

	/**
	 * Scrolls the CodeMirror element to a particular error
	 * @param {!number} errorNumber
	 */
	me.scrollToError = function(errorNumber) {
		if (me.fullyLoaded) {
			let errors = $scope.errors;
			if (errors) {
				let error = errors[errorNumber];
				if (error) {
					jumpToLine($scope.codeMirror, error._line)
				}
				$scope.nextErrorItem = errorNumber + 1
				if ($scope.nextErrorItem >= errors.length) {
					$scope.nextErrorItem = 0;
				}
			}
		}
	}

	/**
	 * Force a lint to go ahead by modifying the options
	 */
	me.parseRule = function() {
		$scope.codeMirror.setOption("lint",
			{
				"getAnnotations": me.javaCheck,
				"async" : true
			}
		)
	}

	me.checkStatus = function(uuid) {
		if (me.running) {
			ruleRunnerService.checkStatus(uuid, $scope.logLevel).then(function(output) {
				let runningRule = new RunningRule(output);
				runningRule.handleOutput(me, $scope)
				if (!runningRule.isDone()) {
					$timeout(function () {
						me.checkStatus(runningRule.uuid)
					}, 2000)
				} else {
					me.running = false;
				}
			})
		}
	}

	me.abortRule = function() {
		if (me.running && $scope.lastUpdateObject && "uuid" in $scope.lastUpdateObject) {
			let uuid = $scope.lastUpdateObject.uuid
			console.debug("Aborting running rule with UUID " + uuid)
			$scope.aborting = true

			ruleRunnerService.asyncAbort(uuid).then((output) => {
				let runningRule = new RunningRule(output);
				runningRule.handleOutput(me, $scope)
				me.running = false;
				$scope.aborting = false
				$scope.lastAbortTime = new Date()
			})
		}
	}

	/**
	 * Invokes the rule
	 * @return {Promise<RunningRule|null>}
	 */
	me.runRule = function() {
		if (me.source.trim() === "") {
			return null
		}

		initRunState()

		me.saveSource();
		console.log(me.variables);

		return ruleRunnerService.runRule(me.source, me.ruleLibraries, me.variables, me.includeWebClasses, me.async, me.ruleTimeout).then((output) => {
			let runningRule = new RunningRule(output);

			runningRule.handleOutput(me, $scope)

			if (runningRule.isAsync()) {
				if (!runningRule.isDone()) {
					$timeout(function () {
						me.checkStatus(runningRule.uuid)
					}, 2000)
				} else {
					me.running = false;
				}
			} else {
				me.running = false;
			}

			$scope.panels.resultselem = true;
			if(me.hideDocumentation){
				$scope.panels.documentationelem = false;
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
	 * @param {function(CodeMirror, *[])} updateLinting
	 */
	me.javaCheck = function(cm, updateLinting) {
		let variables = null
		if (me.loadedRule && me.loadedRule.variables) {
			variables = me.loadedRule.variables
		}

		let source = cm.getValue()

		ruleRunnerService.parseRule(source, me.ruleLibraries, me.includeWebClasses, me.isWorkflowRuleLibrary, me.suppressRawTypeErrors, variables).then(function(data) {
			let found = [];
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
			$scope.errors = found;
			$scope.errorCount = found.length;
			if ($scope.nextErrorItem >= $scope.errors.length) {
				$scope.nextErrorItem = 0;
			}
			updateLinting(cm, found)
		});
	}

	me.toggleDarkMode = function() {
		if ($scope.codeMirror !== undefined) {
			console.log("Setting dark mode to " + me.darkMode);
			if (me.darkMode === true) {
				$scope.codeMirror.setOption("theme", "vibrant-ink")
				$(".sp-body").addClass("dark");
				$(".sp-body-container").addClass("dark");
			} else {
				$scope.codeMirror.setOption("theme", "sailpoint");
				$(".sp-body").removeClass("dark");
				$(".sp-body-container").removeClass("dark");
			}
			localStorage.setItem(DARKMODE_SETTING, me.darkMode);
		}
	}
	
	me.toggleAutoHide = function() {
		localStorage.setItem(AUTO_HIDE_SETTING, me.hideDocumentation);
	}
	
	me.toggleDocumentation = function() {
			// This conditional accounts for if you have just executed code and don't feel like waiting for auto re-open 
			if(me.isDocumentationOpen && $scope.panels.documentationelem && me.hideDocumentation){
				console.log("documentation was already open, leaving me.isDocumentationOpen as is");
			} else {
				me.isDocumentationOpen = !me.isDocumentationOpen;
			}
		
		console.log("documentation has been opened/closed");
	}
		
	$scope.reopenDocumentation = function(){
		console.log("reopening documentation");
		if(me.hideDocumentation){
			$scope.panels.documentationelem = me.isDocumentationOpen;
		}
	}

	me.toggleGenerateVariables = function() {
		console.log("Setting generate variables to " + me.generateVariables)
		localStorage.setItem(GENERATE_VARIABLES_SETTING, me.generateVariables);
	}

	me.startVariables = function() {
		let modalInstance = $uibModal.open({
			animation: true,
			ariaLabelledBy: 'modal-title',
			ariaDescribedBy: 'modal-body',
			size: 'lg',
			templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/modal-variableList.html"),
			controller: 'RuleVariableModalController',
			controllerAs: '$ctrl',
			resolve: {
				state: function () {
					return {
						variables: me.variables
					}
				}
			}
		});

		modalInstance.result.then((output) => {
			if (output.variables) {
				me.variables = output.variables
			}
		})
	}

	CodeMirror.commands.autocomplete = function(cm) {
		cm.showHint(
			{
				hint: CodeMirror.hint.anyword
			}
		);
    }
	
	$scope.$watch("ctrl.source", () => {
		me.saveSource()
	});

	$scope.$watch("ctrl.ruleLibraries", () => {
    	me.saveSource();
    	me.parseRule();
	});

	$scope.$watch("ctrl.includeWebClasses", () => {
		me.parseRule();
		me.saveSource();
	})

	$scope.$watch("ctrl.isWorkflowRuleLibrary", () => {
		me.parseRule();
		me.saveSource();
	})

	$scope.$watch("ctrl.suppressRawTypeErrors", () => {
		me.parseRule();
		me.saveSource();
	})

	$scope.$watch("ctrl.loadedRule", () => {
	    me.saveSource();
	});

	$scope.nextErrorItem = 0;
	
	$scope.resultselem = {
		open: false
	}
	
	$scope.historyelem = {
		open: false
	}
	
	$scope.documentationelem = {
		open: false
	}
	
	$scope.selectizeOptions = {
		maxItems: 10,
		searchField: ['title'],
		searchConjunction: 'or',
		valueField: 'title',
		labelField: 'title'
	}

	/**
	 * This is the input to the CodeMirror object.
	 *
	 * @type {Object.<string, any>}
	 */
	$scope.editorOptions = {
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
	        "getAnnotations": me.javaCheck,
	        "async" : true,
	    },
	};

	/**
	 * CodeMirror onLoad as set up in the CodeMirror-UI element
	 * @param {CodeMirror} cm
	 */
	$scope.onCodeMirrorLoad = (cm) => {
		$scope.codeMirror = cm;
		me.toggleDarkMode()
		me.toggleAutoHide()
	}

	let prevDarkMode = localStorage.getItem(DARKMODE_SETTING) || "false"
	
	let prevHideDocumentation = localStorage.getItem(AUTO_HIDE_SETTING) || "true"

	let prevGenerateVariables = localStorage.getItem(GENERATE_VARIABLES_SETTING) || "true"

	me.darkMode = (prevDarkMode === "true");
	
	me.hideDocumentation = (prevHideDocumentation === "true");

	me.generateVariables = (prevGenerateVariables === "true");

	$scope.$watch("ctrl.darkMode", () => {
		me.toggleDarkMode()
	});
	
	$scope.$watch("ctrl.hideDocumentation", () => {
		me.toggleAutoHide();
	});

	$scope.$watch("ctrl.generateVariables", () => {
		me.toggleGenerateVariables();
	});

	$timeout(() => {
		/**
		 * @type {{libraries: SelectizeLibrary[], source: string, loadedRule: ?LoadedRule, async: boolean}}
		 */
		let lastEntry = getLastSource()

		if (lastEntry.source) {
			me.source = lastEntry.source;
		}

		if (lastEntry.loadedRule) {
			let parsed = lastEntry.loadedRule
			if (parsed != null && parsed.name != null) {
				me.loadedRule = new LoadedRule(parsed.id, parsed.name, parsed.type, parsed.libraries, parsed.originalSource)
			}
		}

		me.async = lastEntry.async

		ruleRunnerService.getRuleLibraries().then((data) => {
			let options = []
			data.forEach((ruleName) => {
				options.push({
					id: ruleName,
					title: ruleName
				})
			});
			$scope.ruleLibraryOptions = options;

			let lastEntry = getLastSource()
			let lastLibs = lastEntry.libraries || []

			let _initRuleLibraries =
				() => {
					if (lastLibs.length > 0) {
						me.ruleLibraries = lastLibs
						me.ruleLibraries.forEach(function (item) {
							me.ruleLibrarySelectize('addItem', item.title)
						})
					}
					me.fullyLoaded = true;
				}

			$timeout(_initRuleLibraries, 500);
		});
	}, 0)
    
    $scope.documentationLink = SailPoint.CONTEXT_PATH + "/doc/javadoc";
}

/**
 * The AngularJS controller for this application
 */
ruleRunnerModule.controller('RuleRunnerController', RuleRunnerController)

/**
 * @param $http
 * @constructor
 */
function RuleRunnerService($http) {
	let me = this

	/**
	 * Gets the list of names and types of existing rules
	 *
	 * @return {Promise<{[string]: {string}}>}
	 */
	me.getRulesList = function(search) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/list');
		return $http.get(PAGE_CONFIG_URL, {params: {search: search}}).then(function(response) {
			return response.data;
		});
	}

	/**
	 * @return {Promise<string[]>}
	 */
	me.getRuleTypes = function() {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/types');
		return $http.get(PAGE_CONFIG_URL).then(function(response) {
			return response.data;
		});
	}

	/**
	 * Gets the type variables for the given type name
	 * @param type {string} The type name
	 * @return {Promise<{[string]: string}>}
	 */
	me.getTypeVariables = function(type) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/signature/' + type);
		return $http.get(PAGE_CONFIG_URL).then(function(response) {
			return response.data;
		});
	}

	/**
	 * Loads the given rule information
	 * @return Promise<LoadedRule>
	 */
	me.loadRule = function(name) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/load');
		return $http.get(PAGE_CONFIG_URL, {params: {name: name}}).then(function(response) {
			return response.data;
		});
	}

	/**
	 * Saves the given rule with the given information
	 * @returns Promise<LoadedRule>
	 */
	me.saveRule = function(id, name, source, type, libraries) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/save');
		return $http.post(PAGE_CONFIG_URL, {id: id, name: name, source: source, type: type, libraries: libraries}).then(function(response) {
			return response.data;
		});
	}

	/**
	 * Gets the list of all rule libraries (i.e. rules without a type)
	 * @return {Promise<string[]>} A list of rule libraries
	 */
	me.getRuleLibraries = function() {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/rl');
		return $http.get(PAGE_CONFIG_URL).then(function(response) {
			return response.data;
		});
	}

	/**
	 * Executes the given source code with the given rule libraries and returns the result
	 * @param {!string} ruleText
	 * @param librariesList
	 * @param {boolean} includeWebClasses
	 * @param {boolean} isWorkflowRuleLibrary
	 * @param {boolean} suppressRawTypeErrors
	 * @param variables
	 * @return Promise<ParseError[]> Error output
	 */
	me.parseRule = function(ruleText, librariesList, includeWebClasses, isWorkflowRuleLibrary, suppressRawTypeErrors, variables) {
		if (ruleText !== undefined) {
			let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/parse');
			// TODO: Handle error output here
			return $http.post(PAGE_CONFIG_URL, {script: ruleText, libraries: librariesList, variables: variables, includeWebClasses: includeWebClasses, isWorkflowRuleLibrary: isWorkflowRuleLibrary, suppressRawTypeErrors: suppressRawTypeErrors}).then(function(response) {
				//console.log(response.data)
				return response.data;
			});
		}
	}

	/**
	 * Executes the given source code with the given rule libraries and returns the result
	 * @param {!string} ruleText
	 * @param {SelectizeLibrary[]} librariesList
	 * @param {boolean} includeWebClasses
	 * @param {boolean} async
	 * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
	 */
	me.runRule = function(ruleText, librariesList= [], variables = [], includeWebClasses= false, async = true, ruleTimeout = "") {
		if (ruleText !== undefined) {
			let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/run');
			// TODO: Handle error output here
			return $http.post(PAGE_CONFIG_URL, {script: ruleText, libraries: librariesList, includeWebClasses: includeWebClasses, async: async, ruleTimeout: ruleTimeout, variables: variables}).then(function(response) {
				//console.log(response.data)
				return response.data;
			});
		}
	}

	/**
	 * Executes the given source code with the given rule libraries and returns the result
	 * @param {!string} uuid
	 * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
	 */
	me.checkStatus = function(uuid, logLevel = LOG_DEBUG) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/asyncUpdate');
		let config = {
			params: {
				uuid: uuid,
				logLevel: logLevel
			}
		}
		// TODO: Handle error output here
		return $http.get(PAGE_CONFIG_URL, config).then(function(response) {
			//console.log(response.data)
			return response.data;
		});
	}

	/**
	 * Executes the given source code with the given rule libraries and returns the result
	 * @param {!string} uuid
	 * @returns {Promise<RunningRule>} The result of the rule execution (typically a string, XML, or JSON, which will be detected above)
	 */
	me.asyncAbort = function(uuid) {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/asyncAbort');
		let params = {
			uuid: uuid,
			logLevel: LOG_DEBUG
		}
		// TODO: Handle error output here
		return $http.post(PAGE_CONFIG_URL, params).then(function(response) {
			//console.log(response.data)
			return response.data;
		});
	}

	me.getMyHistory = function() {
		let PAGE_CONFIG_URL = PluginHelper.getPluginRestUrl('IDWRuleRunnerPlugin/history');

		// TODO: Handle error output here
		return $http.get(PAGE_CONFIG_URL).then(function(response) {
			//console.log(response.data)
			return response.data;
		});
	}

	return me;

}

/**
 * Services that handles functionality around the page configuration.
 */
ruleRunnerModule.service('ruleRunnerService', RuleRunnerService)


/**
 * The controller for the pop-up modal for export to CSV (and possibly other formats later)
 * @param {RuleRunnerService} ruleRunnerService
 * @param $scope
 * @param $uibModalInstance The modal instance
 * @param {object} state The initial modal state
 * @returns
 * @ngInject
 *
 * @typedef RuleSelectionItem
 * @property {string} name
 * @property {string} type
 */
function RuleSelectionModalController(ruleRunnerService, $scope, $uibModalInstance, state) {
    let me = this

	/**
	 * @type {RuleSelectionItem[]}
	 */
    $scope.rulesTable = []

    ruleRunnerService.getRulesList("").then(
    	(output) => {
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
    me.selectItem = (item) => {
        $uibModalInstance.close(item);
    }
}
ruleRunnerModule.controller('RuleSelectionModalController', RuleSelectionModalController);

/**
 * The controller for the pop-up modal for export to CSV (and possibly other formats later)
 * @param {RuleRunnerService} ruleRunnerService
 * @param $scope
 * @param $uibModalInstance The modal instance
 * @param state The initial modal state
 * @returns
 * @ngInject
 */
function RuleNameModalController(ruleRunnerService, $scope, $uibModalInstance, state) {
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

    me.ok = () => {
        let result = {
            ruleName: $scope.ruleName,
            ruleType: $scope.ruleType
        }
        $uibModalInstance.close(result);
    }
	me.cancel = () => {
		$uibModalInstance.dismiss('cancel');
	};
}
ruleRunnerModule.controller('RuleNameModalController', RuleNameModalController);

