/*
 * IID Rule Runner Plugin
 * Copyright (C) 2019-2024 Devin Rosenbauer
 *
 * See the LICENSE file for more details on permitted use
 *
 * Instrumental Identity
 * https://www.instrumentalidentity.com
 */

import {EditorState} from "./RuleHistoryService.js";
import CodeMirror from "codemirror";

export interface HasValue {
    value: any;
}

interface Ext {
    Date: {
        format: (date: Date, str: string) => void;
    }
}

interface PluginHelperIntf {
    getPluginRestUrl: (arg0: string) => string;
    getPluginFileUrl: (arg0: string, arg1: string) => string;
}

export interface LogMessage {
    date: number;
    message: string;
    hasError: boolean;
    level: string;
}

export interface AngularScope {
    $watch(str: string, callback: (arg0: any, arg1: any) => any): void;

    resultselem: Openable;
    documentationelem: Openable;
    historyelem: Openable;

    logLevel: string;

    messages?: string | null;
    messagesPrefix?: string | null;

    showingExecutionHistory: boolean;

    ruleLibrarySelectize?: (a: any, b?: any) => void;

    isDocumentationOpen: boolean;

    documentationLink: string;

    generateVariables: boolean;

    variables: Variable[];

    errors: any[];
    errorCount: number;
    nextErrorItem: number;

    selectizeOptions: Selectize.IOptions<any, any>;

    editorOptions: any & CodeMirror.EditorConfiguration;

    onCodeMirrorLoad: (cm: CodeMirror.Editor) => (void);

    panels: {
        documentationelem: boolean,
        historyelem: boolean,
        resultselem: boolean
    }

    iiqTemplateMaker: (tmpl: string) => string;

    showRecentOnly: {
        flag: boolean
    }

    filterRecent: (historyEntry: EditorState) => boolean;

    codeMirror?: any;

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

