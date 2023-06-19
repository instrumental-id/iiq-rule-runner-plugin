/**
 * @typedef LogMessage
 * @property {number} date
 * @property {string} message
 * @property {boolean} hasError
 * @property {string} level
 */

/**
 * @param {object|RunningRule} json
 * @constructor
 */
function RunningRule(json) {
    /**
     * @type {string}
     */
    this.uuid = json.uuid;

    /**
     * @type {LogMessage[]}
     */
    this.logs = json.logs;

    /**
     * @type {any}
     */
    this.stats = json.stats;

    /**
     * @type {boolean}
     */
    this.async = json.async;

    /**
     * @type {string}
     */
    this.hostname = json.host || "??"

    /**
     * @type {{isNull: boolean, type: string|null, error: {exception: string|null, message: string|null}, done: boolean, value: any}}
     */
    this.output = {
        done: false,
        value: null,
        type: null,
        isNull: false,
        error: {
            exception: null,
            message: null
        }
    }

    if ("output" in json) {
        this.output.done = true
        this.output.value = json.output.value
        this.output.type = json.output.type
        this.output.isNull = json.output.isNull
        if ("exception" in json.output) {
            this.output.error = {
                exception: json.output.exception.exception,
                message: json.output.exception.message
            }
        }
    }
}

/**
 * Handles the output stored in this RunningRule by updating the controller
 * and scope state.
 *
 * @param {RuleRunnerController} controller The AngularJS controller
 * @param {AngularScope} $scope The AngularJS scope
 */
RunningRule.prototype.handleOutput = function(controller, $scope) {
    let runningRule = this;

    // Cached stuff for use in code
    $scope.lastUpdate = new Date();
    $scope.lastUpdateObject = runningRule;

    // Output messages that get displayed directly in the UI
    $scope.errorMessage = null
    $scope.json = null
    $scope.xml = null
    $scope.output = null

    if (runningRule.hostname) {
        $scope.hostname = runningRule.hostname
    }

    if (runningRule.logs) {
        for(let log of runningRule.logs) {
            $scope.logs.push(log);
        }
    }
    if (runningRule.stats !== undefined) {
        if ("progressPercent" in runningRule.stats) {
            document.getElementById("idwRuleRunnerProgress").value = runningRule.stats.progressPercent
        } else {
            document.getElementById("idwRuleRunnerProgress").value = null
        }
        $scope.runningRuleStats = runningRule.stats
    }
    if (runningRule.isError()) {
        $scope.errorMessage = runningRule.getErrorString()
    } else if (runningRule.isDone()) {
        let output = runningRule.output
        if (output.isNull) {
            $scope.output = "(rule returned null output)"
        } else if (typeof output.value === "object") {
            $scope.outputType = output.type
            $scope.json = output.value
            controller.saveHistory();
        } else {
            let value = output.value
            if (value.startsWith("\"")) {
                value = value.substring(1, output.length - 1);
            }
            value = value.replace(/\\"/g, "\"")
            value = value.replace(/\\n/g, "\n")
            value = value.replace(/\\t/g, "\t")
            $scope.outputType = output.type;
            if (value.startsWith("<?xml")) {
                $scope.xml = value
                controller.saveHistory();
            } else {
                $scope.output = value
                controller.saveHistory();
            }
        }
    }
}


/**
 * @return {boolean} True if the running rule is asynchronously continuing
 */
RunningRule.prototype.isAsync = function() {
    return (this.async === true || this.async === "true")
}

/**
 * @return {boolean} True if the running rule is done
 */
RunningRule.prototype.isDone = function() {
    return this.output.done
}

/**
 * @return {boolean} True if the running rule has errors
 */
RunningRule.prototype.isError = function() {
    return ("error" in this.output && (this.output.error.message !== null || this.output.error.exception !== null))
}

/**
 * @return {string|null}
 */
RunningRule.prototype.getErrorString = function() {
    if (!this.isError()) {
        return null
    }
    if (this.output.error.message) {
        return this.output.error.message
    } else {
        return this.output.error.exception
    }
}
