import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import * as monaco from "monaco-editor/editor/editor.api";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";

import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/languages/definitions/bat/register";
import "monaco-editor/languages/definitions/cpp/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/csharp/register";
import "monaco-editor/languages/definitions/go/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/ini/register";
import "monaco-editor/languages/definitions/java/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/less/register";
import "monaco-editor/languages/definitions/lua/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/php/register";
import "monaco-editor/languages/definitions/powershell/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/ruby/register";
import "monaco-editor/languages/definitions/rust/register";
import "monaco-editor/languages/definitions/scss/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/yaml/register";

interface MonacoEnvironmentHost extends Window {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
}

(window as MonacoEnvironmentHost).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

loader.config({ monaco: monaco as typeof Monaco });

monaco.editor.defineTheme("svn-scope-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#FCFCFD",
    "editorGutter.background": "#F8F9FB",
    "editorLineNumber.foreground": "#A8ADB7",
    "editorLineNumber.activeForeground": "#555C68",
    "diffEditor.insertedTextBackground": "#B9F1C780",
    "diffEditor.removedTextBackground": "#FFC8C880",
    "diffEditor.insertedLineBackground": "#E7F8EB",
    "diffEditor.removedLineBackground": "#FDEBEC",
    "diffEditor.diagonalFill": "#EFF1F5",
    "editorOverviewRuler.border": "#E4E7EC",
  },
});
