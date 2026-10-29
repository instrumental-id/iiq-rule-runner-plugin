import {AngularScope, SelectizeLibrary} from "../../types";
import {IScope} from "angular";

import "@selectize/selectize";

import {IPluginHelper, ruleRunnerModule} from "../../IIQModule";
import {PLUGIN_NAME} from "../../app";
import {
    EventBus, EventType
} from "../../services/EventBus";
import {SelectizeLibrariesPayload} from "../../services/EventPayloads";

declare var jQuery: any;
declare var PluginHelper: IPluginHelper;

export class SelectizeComponent {
    selectizeOptions: Selectize.IOptions<any, any>;

    selectizeControl?: Selectize.IApi<any, any>;

    ruleLibraryOptions?: SelectizeLibrary[] = undefined;

    selectedValues: string[];

    constructor(private $element: JQLite, private $scope: AngularScope & IScope, private eventBus: EventBus) {
        this.selectizeOptions = {
            maxItems: 10,
            searchField: ['title'],
            searchConjunction: 'and',
            valueField: 'title',
            labelField: 'title',
            placeholder: "Add rule libraries...",
        }

        this.selectedValues = [];
        
        this.eventBus.register(EventType.STARTING_RULE_RUN, () => {
            if (this.selectizeControl) {
                this.selectizeControl.disable()
            }
        })
        
        this.eventBus.register(EventType.FINISHED_RULE_RUN, () => {
            if (this.selectizeControl) {
                this.selectizeControl.enable()
            }
        })
        
        this.eventBus.register(EventType.ABORTED_RULE_RUN, () => {
            if (this.selectizeControl) {
                this.selectizeControl.enable()
            }
        })

        this.eventBus.register(EventType.RULE_LIBRARIES_LOADED, (args: SelectizeLibrariesPayload) => {
            this.ruleLibraryOptions = args.libraries ?? []

            this.refreshOptions()
        })
        
        this.eventBus.register(EventType.RULE_LIBRARIES_FORCE_SELECT, (args: SelectizeLibrariesPayload) => {
            if (args && args.libraries) {
                console.debug("Forcing selectize to show selected libraries: ", args)
                this.selectedValues = args.libraries.map(lib => lib.title);

                if (this.selectizeControl) {
                    this.selectizeControl.clear();
                    
                    this.selectedValues.forEach((value) => {
                        this.selectizeControl?.addItem(this.selectedValues);
                    })
                }
            } else {
                console.warn("RULE_LIBRARIES_FORCE_SELECT sent without libraries");
            }
        });

    }

    $postLink() {
        let element = this.$element[0];

        let select = element.querySelector("select");

        let options: Selectize.IOptions<any, any> = {
            onChange: (values: string | string[]) => {
                if (Array.isArray(values)) {
                    this.selectedValues = values;
                } else {
                    this.selectedValues = [values];
                }

                this.eventBus.publish(EventType.RULE_LIBRARIES_SELECTED, {
                    libraries: this.selectedValues
                })
            },
            ...this.selectizeOptions
        }

        this.selectizeControl = jQuery(select).selectize(options)[0].selectize;
        
        this.refreshOptions()
    }

    private refreshOptions() {
        if (this.ruleLibraryOptions) {
            this.ruleLibraryOptions.forEach((option) => {
                this.selectizeControl?.addOption(option);
            })
            this.selectizeControl?.refreshOptions(false);
        }
    }
}

ruleRunnerModule.component("selectizeComponent", {
    controller: SelectizeComponent,
    templateUrl: PluginHelper.getPluginFileUrl(PLUGIN_NAME, "ui/templates/component/editor/selectize.component.html")
})