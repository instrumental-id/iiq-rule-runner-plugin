import {ruleRunnerModule} from "../../IIQModule";
import {DARKMODE_SETTING, PLUGIN_NAME} from "../../app";
import {IPluginHelper} from "../../IIQModule";
import {AngularScope, Variable} from "../../types";
import {RuleRunnerService} from "../../services/RuleRunnerService";
import {ApplicationState} from "../../ApplicationState";
import {EditorState} from "../../model/EditorState";
import {
    EventBus, EventType
} from "../../services/EventBus";
import {debounce} from "../../utils";

import CodeMirror from "codemirror";
import "codemirror/addon/lint/lint"
import "codemirror/mode/clike/clike"
import "codemirror/addon/edit/matchbrackets"
import "codemirror/addon/edit/closebrackets"
import "codemirror/addon/hint/show-hint"
import "codemirror/addon/hint/anyword-hint"
import {EditorJumpToLinePayload} from "../../services/EventPayloads";

declare var PluginHelper: IPluginHelper
declare var jQuery: any;

export class CodeMirrorComponent {
    cm: CodeMirror | null;

    source: string;

    state: EditorState;

    darkMode: boolean = false;

    constructor(private $scope: AngularScope, private $element: JQLite, private ruleRunnerService: RuleRunnerService, private eventBus: EventBus, private applicationState: ApplicationState) {
        this.source = "";
        this.cm = null;
        this.state = {} as EditorState;

        this.eventBus.register(EventType.DARKMODE, (args: { darkMode: boolean }) => {
            this.toggleDarkMode(args?.darkMode ?? false);
        })

        this.eventBus.register(EventType.JUMP_TO_LINE, (args: EditorJumpToLinePayload) => {
            if (args && args.lineNumber != null) {
                this.jumpToLine(args.lineNumber);
            } else {
                console.warn("editor.jumpToLine sent without lineNumber");
            }
        });

        this.eventBus.register(EventType.FORCE_LINT, () => {
            this.forceLint();
        })

        this.eventBus.register(EventType.STATE_UPDATED, (args: {state: EditorState}) => {
            this.state = args.state;
        });

        this.eventBus.register(EventType.SOURCE_LOADED, (args: {source: string}) => {
            this.source = args.source;
            this.cm?.setValue(args.source);
        });
    }

    /**
     * This is invoked by CodeMirror when a lint operation is triggered. It is expected to read
     * any errors from some data source, then invoke the updateLinting function with the results
     * once they are available.
     *
     * Note that this is expecting CodeMirror 4, which is the version included with IIQ. The
     * parameters passed here are somewhat different in CodeMirror 5.
     *
     * @param {CodeMirror} lintCm
     * @param {function(CodeMirror, *[]): void} updateLinting
     */
    javaCheck(lintCm: CodeMirror | string, updateLinting: (a: any, b: any[]) => void) {
        let variables: Variable[] | null = null
        if (this.state.loadedRule && this.state.loadedRule.variables) {
            variables = this.state.loadedRule.variables
        }

        let source = "";
        if (lintCm instanceof CodeMirror) {
            source = lintCm.getValue();
        } else {
            source = lintCm;
        }

        if (source == null || source.trim() === "") {
            return;
        }

        this.ruleRunnerService.parseRule(source, this.state.libraries, this.state.includeWebClasses, this.state.isWorkflowRuleLibrary, this.state.suppressRawTypeErrors, variables || []).then((data) => {
            let found: any[] = [];
            for(let item of data) {
                if (item.line !== null) {
                    found.push({
                        message: item.message,
                        from: CodeMirror.Pos(item.line, item.start),
                        to: CodeMirror.Pos(item.line, item.end + 1),
                        severity: "error",
                        _line: item.line
                    })
                }
            }
            let errorObject = {
                errors: found,
                errorCount: found.length
            }

            updateLinting(found, this.cm);

            this.eventBus.publish(EventType.EDITOR_LINTING_COMPLETE, errorObject);
        });
    }


    $postLink() {
        const parent = this.$element[0]
        CodeMirror.commands.autocomplete = function (cm: any) {
            cm.showHint(
                {
                    hint: CodeMirror.hint.anyword
                }
            );
        }

        this.cm = new CodeMirror(parent, {
            lineNumbers: true,
            mode: 'text/x-java',
            readOnly: false,
            theme: 'sailpoint',
            extraKeys: {"Ctrl-Space": "autocomplete"},
            // @ts-ignore - this is part of an extension
            matchBrackets: true,
            autoCloseBrackets: true,
            styleActiveLine: true,
            gutters: ["CodeMirror-lint-markers"],
            lint: {
                "getAnnotations": this.javaCheck.bind(this),
                "async": true,
            }
        })

        this.cm.on('change', debounce(() => {
            const val = this.cm?.getValue()

            if (val !== this.source) {
                this.source = val;
                this.eventBus.publish(EventType.SOURCE_CHANGED, {source: this.source});
            }
        }, 1000))
        
        if (this.source) {
            this.cm.setValue(this.source);
        }
        
        this.eventBus.publish(EventType.EDITOR_READY, {source: this.source});
    }

    private forceLint() {
        this.cm?.setOption(
            // @ts-ignore
            "lint",
            {
                "getAnnotations": this.javaCheck.bind(this),
                "async" : true
            }
        )
    }

    private jumpToLine(lineNumber: number) {
        this.cm?.setCursor({line: lineNumber - 1, ch: 0});
    }

    private toggleDarkMode(darkMode: boolean) {
        console.log("Setting dark mode to " + darkMode);
        this.darkMode = darkMode;
        if (darkMode) {
            this.cm.setOption("theme", "vibrant-ink")
            jQuery(".sp-body").addClass("dark");
            jQuery(".sp-body-container").addClass("dark");
        } else {
            this.cm.setOption("theme", "sailpoint");
            jQuery(".sp-body").removeClass("dark");
            jQuery(".sp-body-container").removeClass("dark");
        }
        localStorage.setItem(DARKMODE_SETTING, String(darkMode));
    }
}

ruleRunnerModule.component('beanshellEditor', {
    controller: CodeMirrorComponent,
    templateUrl: function () {
        return PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/component/editor/codemirror.component.html")
    },
    bindings: {
        applicationState: '<',
        state: '<'
    }
})