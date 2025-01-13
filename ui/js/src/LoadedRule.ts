/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {SelectizeLibrary, Variable} from "./types.js";

export class LoadedRule {

    public id: string;
    public name: string;
    public type: string;
    public libraries: Array<string> | null;
    public originalSource: string | null;
    public description: string | null;
    public variables: Array<Variable>;

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
    isPersisted(): boolean {
        return (this.id != null && this.id.length > 0)
    }

    /**
     * @return {SelectizeLibrary[]}
     */
    getSelectizeLibraries(): SelectizeLibrary[] {
        let selectizeLibraries: SelectizeLibrary[] = []
        if (this.libraries) {
            for (let library of this.libraries) {
                selectizeLibraries.push({title: library})
            }
        }
        return selectizeLibraries
    }
}