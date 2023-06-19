/**
 * The controller for the pop-up modal for export to CSV (and possibly other formats later)
 * @param {RuleRunnerService} ruleRunnerService
 * @param $scope
 * @param $uibModalInstance The modal instance
 * @param state The initial modal state
 * @returns
 * @ngInject
 */
function RuleVariableModalController(ruleRunnerService, $scope, $uibModalInstance, state) {
    let me = this

    console.debug("Input state for the rule variable modal", state)

    $scope.variables = []
    $scope.variableTypeRegex = new RegExp("^(java\..*)|(sailpoint\.object\..*)$")

    for(let v of state.variables) {
        $scope.variables.push(new RuleVariable(v))
    }

    $scope.variableSelected = null
    $scope.variableSelectedIndex = -1

    $scope.templateMaker = function(tmpl) {
        return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/" + tmpl)
    }

    $scope.state = {
        collapsed: true
    }

    $scope.selectVariable = function(v, idx) {
        $scope.variableSelected = new RuleVariable(v)
        $scope.variableSelectedIndex = idx
    }

    me.create = function() {
        $scope.variableSelected = new RuleVariable()
        $scope.variableSelectedIndex = -1
    }

    me.clear = function() {
        $scope.variables = []
        console.log("Cleared variables")
    }

    me.variableSave = function() {
        if ($scope.variableSelected !== null) {
            let updated = new RuleVariable($scope.variableSelected)
            if ($scope.variableSelectedIndex > -1) {
                $scope.variables[$scope.variableSelectedIndex] = updated
            } else {
                $scope.variables.push(updated)
            }
            $scope.variableSelected = null
            $scope.variableSelectedIndex = -1
        }
    }

    me.variableCancel = function() {
        $scope.variableSelected = null
        $scope.variableSelectedIndex = -1
    }

    me.ok = () => {
        let result = {
            ruleName: $scope.ruleName,
            ruleType: $scope.ruleType,
            variables: $scope.variables
        }
        $uibModalInstance.close(result);
    }
    me.cancel = () => {
        $uibModalInstance.dismiss('cancel');
    };
}
ruleRunnerModule.controller('RuleVariableModalController', RuleVariableModalController);

