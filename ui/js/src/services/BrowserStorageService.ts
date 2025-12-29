/**
 * SailPoint IdentityIQ plugin AngularJS page to run rules in the browser
 * (C) 2023-2025 Devin Rosenbauer
 * (C) 2019-2022 Identity Works LLC d/b/a Instrumental Identity
 *
 * See the LICENSE file for more details on permitted use
 *
 * https://www.instrumentalidentity.com
 */
import {ruleRunnerModule} from "../IIQModule";

import * as localForage from "localforage";
import {LocalForageValue} from "../types";

/**
 * Angular service to interact with localForage for storing and retrieving items.
 * Prevents all the other classes from needing to import localForage directly,
 * and allows us to replace it with a mock implementation for testing.
 */
export class BrowserStorageService {
    private readonly localforage: LocalForage;

    constructor() {
        this.localforage = localForage.createInstance({
            name: "localforage",
        });
    }

    /**
     * Retrieves an item using localForage, returning a promise that resolve to the value
     * @param key the key to retrieve
     */
    async getItem(key: string): Promise<LocalForageValue> {
        return await this.localforage.getItem(key);
    }

    /**
     * Sets an item using localForage, returning a promise that resolves to the value
     * @param key the key to set
     * @param value the value to set
     */
    async setItem(key: string, value: LocalForageValue): Promise<LocalForageValue> {
        return await this.localforage.setItem(key, value);
    }
}

ruleRunnerModule.service("browserStorageService", BrowserStorageService);