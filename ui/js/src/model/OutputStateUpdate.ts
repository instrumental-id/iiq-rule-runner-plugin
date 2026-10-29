import {RunningRule} from "./RunningRule";

export interface OutputStateUpdate {
    /**
     * The output that will be rendered in the output panel
     */
    host: string;

    /**
     * The current running rule, if any
     */
    runningRule: RunningRule | null;
}