import { createHash } from "node:crypto";
import ts from "typescript";

export type SchemaSourceTable = {
  name: string;
  fields: string[];
  indexes: string[];
};

export type SchemaSourceInventory = { tables: SchemaSourceTable[] };

export type SchemaSourceTableReview = {
  name: string;
  fieldCount: number;
  fieldsSha256: string;
  indexCount: number;
  indexesSha256: string;
};

export type SchemaSourceInventoryReview = {
  tableCount: number;
  tables: SchemaSourceTableReview[];
};

const sha256 = (values: string[]) =>
  createHash("sha256")
    .update([...values].sort().join("\0"))
    .digest("hex");

export function summarizeSchemaSourceInventory(
  inventory: SchemaSourceInventory,
): SchemaSourceInventoryReview {
  return {
    tableCount: inventory.tables.length,
    tables: inventory.tables
      .map(({ name, fields, indexes }) => ({
        name,
        fieldCount: fields.length,
        fieldsSha256: sha256(fields),
        indexCount: indexes.length,
        indexesSha256: sha256(indexes),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function calledName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function collectValidatorPaths(
  expression: ts.Expression,
  path: string,
  paths: Set<string>,
): void {
  if (!ts.isCallExpression(expression)) {
    paths.add(path);
    return;
  }
  const name = calledName(expression.expression);
  if (
    name === "object" &&
    ts.isObjectLiteralExpression(expression.arguments[0])
  ) {
    for (const property of expression.arguments[0].properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const child = propertyName(property.name);
      if (child) {
        collectValidatorPaths(property.initializer, `${path}.${child}`, paths);
      }
    }
    return;
  }
  if (name === "optional" || name === "array") {
    const inner = expression.arguments[0];
    if (inner) collectValidatorPaths(inner, path, paths);
    else paths.add(path);
    return;
  }
  if (name === "union") {
    paths.add(path);
    for (const variant of expression.arguments) {
      if (
        ts.isCallExpression(variant) &&
        calledName(variant.expression) === "object"
      ) {
        collectValidatorPaths(variant, path, paths);
      }
    }
    return;
  }
  paths.add(path);
}

function defineTableCall(expression: ts.Expression): ts.CallExpression | null {
  if (ts.isParenthesizedExpression(expression)) {
    return defineTableCall(expression.expression);
  }
  if (!ts.isCallExpression(expression)) return null;
  if (calledName(expression.expression) === "defineTable") return expression;
  if (ts.isPropertyAccessExpression(expression.expression)) {
    return defineTableCall(expression.expression.expression);
  }
  return null;
}

function collectIndexes(expression: ts.Expression, indexes: Set<string>): void {
  if (ts.isParenthesizedExpression(expression)) {
    collectIndexes(expression.expression, indexes);
    return;
  }
  if (!ts.isCallExpression(expression)) return;
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "index"
  ) {
    const indexName = expression.arguments[0];
    if (ts.isStringLiteral(indexName)) {
      if (indexes.has(indexName.text)) {
        throw new Error(`Duplicate index: ${indexName.text}`);
      }
      indexes.add(indexName.text);
    }
    collectIndexes(expression.expression.expression, indexes);
  }
}

export function parseSchemaSourceInventory(
  source: string,
): SchemaSourceInventory {
  const sourceFile = ts.createSourceFile(
    "schema.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const tables: SchemaSourceTable[] = [];
  const tableNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      const tableCall = defineTableCall(node.initializer);

      if (!name || !tableCall) {
        ts.forEachChild(node, visit);
        return;
      }

      const fieldsArgument = tableCall.arguments[0];
      if (fieldsArgument && ts.isObjectLiteralExpression(fieldsArgument)) {
        if (tableNames.has(name)) {
          throw new Error(`Duplicate table: ${name}`);
        }
        tableNames.add(name);

        const fields = new Set<string>();
        for (const property of fieldsArgument.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const fieldName = propertyName(property.name);
          if (fieldName)
            collectValidatorPaths(property.initializer, fieldName, fields);
        }

        const indexes = new Set<string>();
        collectIndexes(node.initializer, indexes);
        tables.push({
          name,
          fields: [...fields].sort(),
          indexes: [...indexes].sort(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { tables };
}
