/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {SelectizeLibrary, Variable} from "../types";

/**
 * A rule that has been loaded from the server, via the "Load" button in the editor
 */
export class LoadedRule {
    /**
     * The server-side ID of the rule
     */
    id: string;

    /**
     * The name of the rule
     */
    name: string;

    /**
     * The type of the rule, e.g., "BeforeProvisioning" or "Correlation"
     */
    type: string;

    /**
     * The names of any rule libraries that this rule uses
     */
    libraries: Array<string> | null;

    /**
     * The original source of the rule, before any changes in the editor
     */
    originalSource: string | null;

    /**
     * A description of the rule, if any
     */
    description: string | null;

    /**
     * The variables that are defined in this rule, by type
     */
    variables: Array<Variable>;

    constructor(json: any) {
        this.id = json.id

        this.name = json.name

        this.type = json.type || ""

        this.libraries = json.libraries || []

        this.originalSource = json.originalSource || json.source;

        this.description = json.description

        this.variables = json.variables || []
    }

    /**
     * Returns true if this Rule has been persisted to the database, false if it is
     * ephemeral on the client side.
     *
     * @return {boolean}
     */
    get persisted(): boolean {
        return (this.id != null && this.id.length > 0)
    }

    /**
     * @return {SelectizeLibrary[]}
     */
    get selectizeLibraries(): SelectizeLibrary[] {
        let selectizeLibraries: SelectizeLibrary[] = []
        if (this.libraries) {
            for (let library of this.libraries) {
                selectizeLibraries.push({title: library})
            }
        }
        return selectizeLibraries
    }
}