import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "../..");
const extensionsRoot = resolve(projectRoot, "extensions");
const rootEntry = resolve(extensionsRoot, "index.ts");

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function localRuntimeImports(path: string): string[] {
  const imports: string[] = [];
  for (const statement of sourceFile(path).statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      !clause.name &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    )
      continue;
    const target = resolve(dirname(path), specifier);
    imports.push(target.endsWith(".ts") ? target : `${target}.ts`);
  }
  return imports;
}

function calledNames(path: string): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) names.add(node.expression.text);
      else if (ts.isPropertyAccessExpression(node.expression))
        names.add(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(path));
  return names;
}

function callCount(path: string, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === name) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === name))
    )
      count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(path));
  return count;
}

function reexportsDefault(path: string): boolean {
  return sourceFile(path).statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) =>
          element.name.text === "default" ||
          element.propertyName?.text === "default",
      ),
  );
}

function findCycle(
  graph: ReadonlyMap<string, readonly string[]>,
): string[] | undefined {
  const active = new Set<string>();
  const complete = new Set<string>();
  const path: string[] = [];

  const visit = (node: string): string[] | undefined => {
    if (active.has(node)) {
      const start = path.indexOf(node);
      return [...path.slice(start), node];
    }
    if (complete.has(node)) return undefined;
    active.add(node);
    path.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(node);
    complete.add(node);
    return undefined;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

test("keeps Pi host construction in the root and production dependencies directed", () => {
  const files = productionFiles(extensionsRoot);
  const rootCalls = calledNames(rootEntry);
  assert.equal(
    rootCalls.has("installClickExpansion"),
    true,
    "root must construct click expansion",
  );
  assert.equal(
    rootCalls.has("createDiffPresentationModule"),
    true,
    "root must construct diff presentation",
  );
  assert.equal(
    rootCalls.has("createToolPresentationModule"),
    true,
    "root must construct tool presentation",
  );
  assert.equal(
    callCount(rootEntry, "installPiHost"),
    1,
    "root must invoke one Pi host installer exactly once",
  );
  assert.equal(
    reexportsDefault(rootEntry),
    false,
    "root must define composition instead of re-exporting a default",
  );

  for (const file of files) {
    if (file === rootEntry) continue;
    const imports = localRuntimeImports(file);
    assert.equal(
      imports.includes(rootEntry),
      false,
      `${relative(projectRoot, file)} must not import the composition root`,
    );
    const calls = calledNames(file);
    assert.equal(
      calls.has("installClickExpansion") ||
        calls.has("createDiffPresentationModule") ||
        calls.has("createToolPresentationModule"),
      false,
      `${relative(projectRoot, file)} must not construct shared runtime modules`,
    );
  }

  const hostRoot = resolve(extensionsRoot, "pi-host");
  const hostFiles = productionFiles(hostRoot);
  const hostSet = new Set(hostFiles);
  const graph = new Map(
    hostFiles.map((file) => [
      file,
      localRuntimeImports(file).filter((dependency) => hostSet.has(dependency)),
    ]),
  );
  const cycle = findCycle(graph);
  assert.equal(
    cycle,
    undefined,
    cycle?.map((file) => relative(projectRoot, file)).join(" -> "),
  );
});
