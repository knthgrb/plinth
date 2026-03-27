"use client";

type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  [key: string]: unknown;
};

export const LEAVE_REQUEST_TEMPLATE_PLACEHOLDERS = [
  "{{employeeName}}",
  "{{department}}",
  "{{position}}",
  "{{dateRequested}}",
  "{{leaveType}}",
  "{{startDate}}",
  "{{endDate}}",
  "{{requestedDays}}",
  "{{reason}}",
  "{{signatureName}}",
] as const;

type TemplateSection = {
  id: string;
  label: string;
  description: string;
  blocks: TiptapNode[];
};

function createText(text: string): TiptapNode {
  return { type: "text", text };
}

function createParagraph(text: string): TiptapNode {
  return {
    type: "paragraph",
    content: [createText(text)],
  };
}

function createHeading(text: string, level: 2 | 3): TiptapNode {
  return {
    type: "heading",
    attrs: { level },
    content: [createText(text)],
  };
}

function createCell(text: string, header = false): TiptapNode {
  return {
    type: header ? "tableHeader" : "tableCell",
    content: [
      {
        type: "paragraph",
        content: [createText(text)],
      },
    ],
  };
}

function createRow(cells: string[], header = false): TiptapNode {
  return {
    type: "tableRow",
    content: cells.map((cell) => createCell(cell, header)),
  };
}

function createTable(rows: string[][]): TiptapNode {
  return {
    type: "table",
    content: rows.map((row, index) => createRow(row, index === 0)),
  };
}

export const LEAVE_REQUEST_TEMPLATE_SECTIONS: TemplateSection[] = [
  {
    id: "employee-details",
    label: "Add employee details",
    description: "Insert a structured employee information section.",
    blocks: [
      createHeading("Employee Details", 3),
      createTable([
        ["Field", "Value"],
        ["Employee Name", "{{employeeName}}"],
        ["Department", "{{department}}"],
        ["Position", "{{position}}"],
      ]),
    ],
  },
  {
    id: "request-details",
    label: "Add request details",
    description: "Insert date, leave type, dates, and reason rows.",
    blocks: [
      createHeading("Request Details", 3),
      createTable([
        ["Field", "Value"],
        ["Date Requested", "{{dateRequested}}"],
        ["Leave Type", "{{leaveType}}"],
        ["Requested Period", "{{startDate}} to {{endDate}}"],
        ["Requested Days", "{{requestedDays}}"],
        ["Reason/s", "{{reason}}"],
      ]),
    ],
  },
  {
    id: "signatures",
    label: "Add signature section",
    description: "Insert employee signature line.",
    blocks: [
      createHeading("Signatures", 3),
      createParagraph("Employee Signature: {{signatureName}}"),
    ],
  },
];

export const DEFAULT_LEAVE_REQUEST_TEMPLATE = JSON.stringify({
  type: "doc",
  content: [
    createHeading("Leave Request Form", 2),
    createParagraph(
      "Complete the details below before submitting this leave request for review.",
    ),
    ...LEAVE_REQUEST_TEMPLATE_SECTIONS.flatMap((section) => section.blocks),
  ],
});

function replaceTokens(text: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    text,
  );
}

function replaceTokensInNode(
  node: TiptapNode | TiptapNode[] | null | undefined,
  replacements: Record<string, string>,
): TiptapNode | TiptapNode[] | null | undefined {
  if (Array.isArray(node)) {
    return node.map((item) => replaceTokensInNode(item, replacements) as TiptapNode);
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  const updatedNode: TiptapNode = { ...node };

  if (typeof updatedNode.text === "string") {
    updatedNode.text = replaceTokens(updatedNode.text, replacements);
  }

  if (Array.isArray(updatedNode.content)) {
    updatedNode.content = updatedNode.content.map(
      (child) => replaceTokensInNode(child, replacements) as TiptapNode,
    );
  }

  return updatedNode;
}

export function getParsedLeaveRequestTemplate(
  content?: string | null,
): TiptapNode {
  if (!content) {
    return JSON.parse(DEFAULT_LEAVE_REQUEST_TEMPLATE) as TiptapNode;
  }

  try {
    return JSON.parse(content) as TiptapNode;
  } catch {
    return JSON.parse(DEFAULT_LEAVE_REQUEST_TEMPLATE) as TiptapNode;
  }
}

export function fillLeaveRequestTemplate(
  content: string | null | undefined,
  replacements: Record<string, string>,
): string {
  const parsed = getParsedLeaveRequestTemplate(content);
  const replaced = replaceTokensInNode(parsed, replacements) as TiptapNode;
  return JSON.stringify(replaced);
}
