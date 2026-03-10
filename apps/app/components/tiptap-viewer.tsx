"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { useEffect, useMemo } from "react";

type TiptapDoc = {
  type: string;
  content?: unknown[];
  [key: string]: unknown;
};

interface TiptapViewerProps {
  content: string | TiptapDoc | null | undefined;
  className?: string;
}

export function TiptapViewer({ content, className }: TiptapViewerProps) {
  const parsedContent = useMemo(() => {
    if (typeof content === "string") {
      if (!content.trim()) return "";
      try {
        return JSON.parse(content);
      } catch {
        return "";
      }
    }
    return content ?? "";
  }, [content]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: "text-blue-600 underline",
        },
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: parsedContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none rounded-md bg-white p-4 text-[rgb(64,64,64)] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(parsedContent || { type: "doc", content: [] });
  }, [editor, parsedContent]);

  if (!editor) {
    return null;
  }

  return (
    <div className={className}>
      <EditorContent
        editor={editor}
        className="[&_table]:w-full [&_table]:border-collapse [&_table]:border [&_table]:border-[rgb(210,210,210)] [&_th]:border [&_th]:border-[rgb(210,210,210)] [&_th]:bg-[rgb(245,245,245)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-[rgb(220,220,220)] [&_td]:px-3 [&_td]:py-2"
      />
    </div>
  );
}
