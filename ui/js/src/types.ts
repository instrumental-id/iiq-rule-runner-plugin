/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2025 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import CodeMirror from "codemirror";
import {EditorState} from "./model/EditorState";

export interface HasValue {
    value: any;
}

export type LogLevel = "Trace" | "Debug" | "Info" | "Warn" | "Error" | "Fatal";

interface Ext {
    Date: {
        format: (date: Date, str: string) => void;
    }
}

export interface LogMessage {
    date: number;
    message: string;
    hasError: boolean;
    level: string;
}

export interface AngularScope {
    $watch(str: string, callback: (arg0: any, arg1: any) => any): void;

    logLevel: string;

    documentationLink: string;

    iiqTemplateMaker: (tmpl: string) => string;

    filterRecent: (historyEntry: EditorState) => boolean;

    codeMirror?: any;

}

export interface EditorComponentScope extends AngularScope {
    messages?: string | null;
    messagesPrefix?: string | null;

    errors: any[];
    errorCount: number;
    nextErrorItem: number;

    selectizeOptions: Selectize.IOptions<any, any>;

    ruleLibraryOptions: any[];

}

export interface UIBModalInstance {
    close: (output: any) => void;
    dismiss: (output: string) => void;
}

export interface Openable {
    open: boolean;
}

export interface ParseError {
    message: string;
    line: number;
    start: number;
    end: number;
}

export interface SelectizeLibrary {
    title: string;
}

export interface Variable {
    provided?: boolean;
    name: string;
    type?: string;
}

export type LocalForageValue = (Object | String | Number | any[] | ArrayBuffer | Blob | null);

export interface LocalForageIntf {
    getItem(key: string): Promise<LocalForageValue>;
    setItem(key: string, value: LocalForageValue): Promise<LocalForageValue>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
}
