"use client";

import { useEffect, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { TextSelection } from "@tiptap/pm/state";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Link as LinkIcon,
  Table2,
  Rows3,
  Columns3,
  Trash2,
} from "lucide-react";

type TiptapDoc = {
  type: string;
  content?: unknown[];
  [key: string]: unknown;
};

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [] };

interface TiptapEditorProps {
  content: string | TiptapDoc | null | undefined;
  onChange: (content: string) => void;
  placeholder?: string;
}

export function TiptapEditor({
  content,
  onChange,
  placeholder = "Start typing...",
}: TiptapEditorProps) {
  const parsedContent = useMemo(() => {
    if (typeof content === "string") {
      if (!content || content.trim() === "" || content === JSON.stringify(EMPTY_DOC)) {
        return EMPTY_DOC;
      }

      try {
        const parsed = JSON.parse(content) as TiptapDoc;
        if (parsed?.content && parsed.content.length === 0) {
          return EMPTY_DOC;
        }
        return parsed;
      } catch {
        return EMPTY_DOC;
      }
    }

    if (
      content &&
      typeof content === "object" &&
      "content" in content &&
      Array.isArray(content.content)
    ) {
      return content.content.length > 0 ? content : EMPTY_DOC;
    }

    return EMPTY_DOC;
  }, [content]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: parsedContent as Record<string, unknown>,
    immediatelyRender: false,
    onCreate: ({ editor }) => {
      if (editor.isEmpty) {
        editor.commands.setTextSelection(0);
      }
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      if (json.content && json.content.length > 0) {
        onChange(JSON.stringify(json));
      } else {
        onChange(JSON.stringify(EMPTY_DOC));
      }
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[200px] max-w-none p-4",
        "data-placeholder": placeholder,
      },
      handleDOMEvents: {
        focus: (view) => {
          if (view.state.doc.content.size === 0) {
            setTimeout(() => {
              const pos = Math.min(1, view.state.doc.content.size);
              const tr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, pos),
              );
              view.dispatch(tr);
            }, 0);
          }
          return false;
        },
      },
    },
  });

  useEffect(() => {
    if (editor) {
      const handleFocus = () => {
        if (editor.isEmpty) {
          setTimeout(() => {
            editor.commands.setTextSelection(0);
          }, 0);
        }
      };

      if (editor.isEmpty) {
        editor.commands.setTextSelection(0);
      }

      editor.on("focus", handleFocus);

      return () => {
        editor.off("focus", handleFocus);
      };
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(parsedContent);

    if (current !== next) {
      editor.commands.setContent(parsedContent as Record<string, unknown>, false);
    }
  }, [editor, parsedContent]);

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    if (url === null) {
      return;
    }

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rounded-md border border-gray-300">
      <div className="flex flex-wrap gap-1 border-b border-gray-300 bg-gray-50 p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={editor.isActive("bold") ? "bg-gray-200" : ""}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={editor.isActive("italic") ? "bg-gray-200" : ""}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-gray-300" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          className={
            editor.isActive("heading", { level: 1 }) ? "bg-gray-200" : ""
          }
        >
          H1
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          className={
            editor.isActive("heading", { level: 2 }) ? "bg-gray-200" : ""
          }
        >
          H2
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          className={
            editor.isActive("heading", { level: 3 }) ? "bg-gray-200" : ""
          }
        >
          H3
        </Button>
        <div className="mx-1 h-6 w-px bg-gray-300" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive("bulletList") ? "bg-gray-200" : ""}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive("orderedList") ? "bg-gray-200" : ""}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive("blockquote") ? "bg-gray-200" : ""}
        >
          <Quote className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-gray-300" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={setLink}
          className={editor.isActive("link") ? "bg-gray-200" : ""}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-gray-300" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run()
          }
        >
          <Table2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().addRowAfter().run()}
          disabled={!editor.isActive("table")}
        >
          <Rows3 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          disabled={!editor.isActive("table")}
        >
          <Columns3 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().deleteTable().run()}
          disabled={!editor.isActive("table")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-gray-300" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>
      <EditorContent
        editor={editor}
        className="max-h-[500px] min-h-[200px] overflow-y-auto [&_table]:w-full [&_table]:border-collapse [&_table]:border [&_table]:border-[rgb(210,210,210)] [&_th]:border [&_th]:border-[rgb(210,210,210)] [&_th]:bg-[rgb(245,245,245)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-[rgb(220,220,220)] [&_td]:px-3 [&_td]:py-2"
      />
    </div>
  );
}
