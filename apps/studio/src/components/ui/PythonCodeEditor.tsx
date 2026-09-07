import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import type { FunctionInput } from "../../domain/functions";

const studioEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--console)",
      color: "#dbeafe",
      fontSize: "12px",
    },
    ".cm-content": {
      minHeight: "320px",
      padding: "14px 0",
      caretColor: "#93c5fd",
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: "1.65",
    },
    ".cm-line": { padding: "0 16px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#93c5fd" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#1e3a5f !important",
    },
    ".cm-activeLine": { backgroundColor: "rgba(148, 163, 184, 0.08)" },
    ".cm-gutters": {
      backgroundColor: "#0b1220",
      color: "#52637a",
      borderRight: "1px solid #1e293b",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(148, 163, 184, 0.08)",
      color: "#94a3b8",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#1e293b",
      border: "none",
      color: "#94a3b8",
    },
    ".cm-panels": { backgroundColor: "#0b1220", color: "#dbeafe" },
    ".cm-searchMatch": { backgroundColor: "#854d0e" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#a16207" },
  },
  { dark: true },
);

const studioHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: "#c4b5fd" },
  { tag: [tags.name, tags.variableName], color: "#dbeafe" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.name)], color: "#7dd3fc" },
  { tag: [tags.string, tags.special(tags.string)], color: "#86efac" },
  { tag: [tags.number, tags.bool, tags.null], color: "#fbbf24" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#64748b", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#f9a8d4" },
  { tag: tags.typeName, color: "#67e8f9" },
]);

export function PythonCodeEditor({
  id,
  value,
  inputs,
  onChange,
}: {
  id: string;
  value: string;
  inputs: FunctionInput[];
  onChange: (value: string) => void;
}) {
  const completeInputs = (context: CompletionContext) => {
    const match = context.matchBefore(/inputs(?:(?:\.get)?\(|\[|\.)?["']?[A-Za-z0-9_]*/);
    if (!match || (!context.explicit && match.from === match.to)) return null;
    return {
      from: match.from,
      options: inputs.map((input) => ({
        label: `inputs["${input.name}"]`,
        apply: `inputs["${input.name}"]`,
        type: "variable",
        detail: `${input.type}${input.required ? " · required" : " · optional"}`,
        info: input.description || undefined,
      })),
      validFor: /^inputs(?:(?:\.get)?\(|\[|\.)?["']?[A-Za-z0-9_]*$/,
    };
  };

  return (
    <div
      id={id}
      className="python-code-editor overflow-hidden rounded-xl border border-[#26364a] bg-[var(--console)] shadow-inner focus-within:ring-2 focus-within:ring-[var(--ring)]"
    >
      <div className="flex h-10 items-center border-b border-[#26364a] bg-[#0b1220] px-3.5">
        <span className="inline-flex items-center gap-2 rounded-md border border-[#34445a] bg-[#172033] px-2.5 py-1 text-[10px] font-bold text-[#c4b5fd]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a78bfa]" />
          Python
        </span>
      </div>
      <CodeMirror
        value={value}
        height="360px"
        theme={studioEditorTheme}
        extensions={[
          python(),
          indentUnit.of("    "),
          keymap.of([indentWithTab]),
          lineNumbers(),
          autocompletion({ override: [completeInputs], activateOnTyping: true }),
          syntaxHighlighting(studioHighlightStyle),
        ]}
        basicSetup={{
          lineNumbers: false,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: true,
          crosshairCursor: false,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: false,
        }}
        onChange={onChange}
        aria-label="Python function body"
      />
    </div>
  );
}
