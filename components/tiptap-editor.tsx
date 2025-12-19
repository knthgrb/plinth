"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
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
} from "lucide-react";
import { useEffect } from "react";

interface TiptapEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export function TiptapEditor({
  content,
  onChange,
  placeholder = "Start typing...",
}: TiptapEditorProps) {
  // Parse content - handle both JSON string and object
  const getParsedContent = () => {
    if (typeof content === "string") {
      if (
        !content ||
        content.trim() === "" ||
        content === '{"type":"doc","content":[]}'
      ) {
        return ""; // Empty string for truly empty editor
      }
      try {
        const parsed = JSON.parse(content);
        // Check if content is actually empty
        if (parsed.content && parsed.content.length === 0) {
          return "";
        }
        return parsed;
      } catch {
        return "";
      }
    }
    // If it's an object, check if it has content
    if (content && content.content && content.content.length > 0) {
      return content;
    }
    return "";
  };

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
    ],
    content: getParsedContent(),
    onCreate: ({ editor }) => {
      // When editor is created and empty, set cursor to position 0
      if (editor.isEmpty) {
        editor.commands.setTextSelection(0);
      }
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      // Only save if there's actual content
      if (json.content && json.content.length > 0) {
        onChange(JSON.stringify(json));
      } else {
        onChange(JSON.stringify({ type: "doc", content: [] }));
      }
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[200px] max-w-none p-4",
        "data-placeholder": placeholder,
      },
      handleDOMEvents: {
        focus: (view, event) => {
          // When editor is focused and empty, ensure cursor is at position 0
          if (view.state.doc.content.size === 0) {
            setTimeout(() => {
              view.dispatch(
                view.state.tr.setSelection(
                  view.state.selection.constructor.near(
                    view.state.doc.resolve(0)
                  )
                )
              );
            }, 0);
          }
        },
      },
    },
  });

  // Ensure cursor is at the start when editor is empty
  useEffect(() => {
    if (editor) {
      // When editor is empty and focused, ensure cursor is at position 0
      const handleFocus = () => {
        if (editor.isEmpty) {
          // Use setTimeout to ensure this runs after Tiptap's internal focus handling
          setTimeout(() => {
            editor.commands.setTextSelection(0);
          }, 0);
        }
      };

      // Also set cursor position on mount if editor is empty
      if (editor.isEmpty) {
        editor.commands.setTextSelection(0);
      }

      // Add focus event listener
      editor.on("focus", handleFocus);

      return () => {
        editor.off("focus", handleFocus);
      };
    }
  }, [editor]);

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
    <div className="border border-gray-300 rounded-md">
      <div className="flex flex-wrap gap-1 p-2 border-b border-gray-300 bg-gray-50">
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
        <div className="w-px h-6 bg-gray-300 mx-1" />
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
        <div className="w-px h-6 bg-gray-300 mx-1" />
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
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={setLink}
          className={editor.isActive("link") ? "bg-gray-200" : ""}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-gray-300 mx-1" />
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
        className="min-h-[200px] max-h-[500px] overflow-y-auto"
      />
    </div>
  );
}
