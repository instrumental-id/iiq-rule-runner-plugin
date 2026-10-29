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

import {RuleVariable} from "./model/RuleVariable";
import {IPluginHelper} from "./IIQModule";
import {UIBModalInstance} from "./types";
import {PLUGIN_NAME} from "./app";

declare var PluginHelper: IPluginHelper;

interface RuleVariableModalInput {
    variables: any[];
}

export interface RuleVariableModalOutput {
    ruleName: string;

    ruleType: string;

    variables: any[]
}

export class RuleVariableModalController {
    constructor(private $scope: any, private $uibModalInstance: UIBModalInstance, state: RuleVariableModalInput) {
        console.debug("Input state for the rule variable modal", state)

        $scope.variables = []
        $scope.variableTypeRegex = new RegExp("^(java\..*)|(sailpoint\.object\..*)$")

        // This can be undefined if the modal is opened without any initial state
        if (state.variables) {
            for (let v of state.variables) {
                $scope.variables.push(new RuleVariable(v))
            }
        }

        $scope.variableSelected = null
        $scope.variableSelectedIndex = -1

        $scope.templateMaker = function(tmpl: string) {
            return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/" + tmpl)
        }

        $scope.state = {
            collapsed: true
        }

        $scope.selectVariable = function(v, idx) {
            $scope.variableSelected = new RuleVariable(v)
            $scope.variableSelectedIndex = idx
        }
    }

    create() {
        this.$scope.variableSelected = new RuleVariable()
        this.$scope.variableSelectedIndex = -1
    }

    clear() {
        this.$scope.variables = []
        console.log("Cleared variables")
    }

    variableSave() {
        if (this.$scope.variableSelected !== null) {
            let updated = new RuleVariable(this.$scope.variableSelected)
            if (this.$scope.variableSelectedIndex > -1) {
                this.$scope.variables[this.$scope.variableSelectedIndex] = updated
            } else {
                this.$scope.variables.push(updated)
            }
            this.$scope.variableSelected = null
            this.$scope.variableSelectedIndex = -1
        }
    }

    variableCancel() {
        this.$scope.variableSelected = null
        this.$scope.variableSelectedIndex = -1
    }

    ok(){
        let result: RuleVariableModalOutput = {
            ruleName: this.$scope.ruleName,
            ruleType: this.$scope.ruleType,
            variables: this.$scope.variables
        }
        this.$uibModalInstance.close(result);
    }

    cancel() {
        this.$uibModalInstance.dismiss('cancel');
    }
}

ruleRunnerModule.controller('RuleVariableModalController', RuleVariableModalController);

