"use client";

import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { useTheme } from "next-themes";

interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SQLEditor({ value, onChange }: SQLEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <CodeMirror
      value={value}
      height="200px"
      extensions={[sqlLang()]}
      onChange={onChange}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: true,
      }}
      className="text-sm"
    />
  );
}
