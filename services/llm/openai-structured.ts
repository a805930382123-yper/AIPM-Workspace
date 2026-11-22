// KB02's wire contract is derived from the loaded business schema. Business validation
// deliberately remains separate; only originally optional properties may become null.
import { LlmError } from './provider.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';

export type StructuredOutput = { name: string; schema: JsonSchemaNode };

export function kb02StructuredOutput(name: string, schema: JsonSchemaNode): StructuredOutput {
  const convert = (node: JsonSchemaNode, optional = false): JsonSchemaNode => {
    const { $schema, $id, ...wire } = node;
    if (node.properties) {
      wire.properties = Object.fromEntries(
        Object.entries(node.properties).map(([key, child]) => [key, convert(child, !node.required?.includes(key))]),
      );
      wire.required = Object.keys(node.properties);
      wire.additionalProperties = false;
    }
    if (node.items) wire.items = convert(node.items);
    if (optional) {
      wire.type = [...new Set([...(Array.isArray(node.type) ? node.type : [node.type!]), 'null'])];
      if (node.enum) wire.enum = [...node.enum, null];
    }
    return wire;
  };
  return { name, schema: convert(schema) };
}

export function decodeKb02StructuredOutput(value: unknown, business: JsonSchemaNode, wire: StructuredOutput): unknown {
  const issues = validateSchema(value, wire.schema);
  if (issues.length)
    throw new LlmError('LLM_SCHEMA_INVALID', `KB02 wire 响应未通过严格结构校验（${issues.length}项）。`, 502, {
      errors: issues.slice(0, 20),
    });
  // Shape was checked above. Walk typed values, removing only optional null slots.
  const omitOptionalNulls = (item: unknown, node: JsonSchemaNode): unknown => {
    if (node.properties && item !== null) {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(record)
          .filter(([key, child]) => child !== null || node.required?.includes(key))
          .map(([key, child]) => [key, omitOptionalNulls(child, node.properties![key])]),
      );
    }
    if (node.items) return (item as unknown[]).map((child) => omitOptionalNulls(child, node.items!));
    return item;
  };
  return omitOptionalNulls(value, business);
}
