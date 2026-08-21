const MODEL_TEXT_LIMIT = 320;

function prefix(context = {}) {
  const runId = context.runId ?? "run";
  const attempt = context.attempt ?? 1;
  return `[${runId} attempt ${attempt}]`;
}

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text, limit = MODEL_TEXT_LIMIT) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function formatError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return "unknown error";
}

function firstImage(content) {
  return Array.isArray(content)
    ? content.find((entry) => entry && entry.type === "image")
    : undefined;
}

function hasImage(content) {
  return Boolean(firstImage(content));
}

function coordinates(args = {}) {
  const x = Number.isFinite(args.x) ? args.x : undefined;
  const y = Number.isFinite(args.y) ? args.y : undefined;
  return x === undefined || y === undefined ? undefined : `(${x}, ${y})`;
}

function completionSummary(tool, args = {}, result = {}) {
  if (tool === "observe") return "screenshot updated";
  if (tool === "wait" && hasImage(result.content)) return "screenshot updated";
  if (tool === "wait" && Number.isFinite(args.milliseconds)) return `after ${args.milliseconds}ms`;
  return undefined;
}

export function formatModelMessage(text, context = {}) {
  const normalized = truncate(normalizeWhitespace(text));
  return normalized ? `${prefix(context)} ${normalized}` : prefix(context);
}

export function summarizeToolEvent(event, context = {}) {
  if (event?.item?.type !== "mcp_tool_call") return undefined;

  const { item } = event;
  const tool = item.tool ?? "tool";
  const coord = coordinates(item.arguments);
  const errorText = truncate(normalizeWhitespace(formatError(item.error)));

  if (event.type === "item.started") {
    if (tool === "wait" && Number.isFinite(item.arguments?.milliseconds)) {
      return `${prefix(context)} tool wait started for ${item.arguments.milliseconds}ms`;
    }
    if (coord) return `${prefix(context)} tool ${tool} started at ${coord}`;
    return `${prefix(context)} tool ${tool} started`;
  }

  if (event.type === "item.completed") {
    if (item.status === "failed" || errorText) {
      const location = coord ? ` at ${coord}` : "";
      return `${prefix(context)} tool ${tool} failed${location}: ${errorText || "unknown error"}`;
    }

    if (tool === "wait" && Number.isFinite(item.arguments?.milliseconds)) {
      const suffix = completionSummary(tool, item.arguments, item.result);
      return suffix === "screenshot updated"
        ? `${prefix(context)} tool wait completed after ${item.arguments.milliseconds}ms; ${suffix}`
        : `${prefix(context)} tool wait completed after ${item.arguments.milliseconds}ms`;
    }

    const suffix = completionSummary(tool, item.arguments, item.result);
    if (suffix) return `${prefix(context)} tool ${tool} completed; ${suffix}`;
    if (coord) return `${prefix(context)} tool ${tool} completed at ${coord}`;
    return `${prefix(context)} tool ${tool} completed`;
  }

  return undefined;
}

export function formatCodexEvent(event, context = {}) {
  if (!event || typeof event !== "object") return undefined;

  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    return formatModelMessage(event.item.text, context);
  }

  const toolSummary = summarizeToolEvent(event, context);
  if (toolSummary) return toolSummary;

  if (event.type === "turn.completed") {
    const usage = event.usage ?? {};
    return `${prefix(context)} turn completed; tokens in=${usage.input_tokens ?? 0} cached=${usage.cached_input_tokens ?? 0} out=${usage.output_tokens ?? 0} reasoning=${usage.reasoning_output_tokens ?? 0}`;
  }

  if (event.type === "turn.started") return `${prefix(context)} turn started`;

  if (event.type === "thread.started") return undefined;

  if (event.type === "error") {
    return `${prefix(context)} error: ${truncate(normalizeWhitespace(formatError(event.error ?? event.message ?? event)))}`;
  }

  if (typeof event.type === "string") return `${prefix(context)} event ${event.type}`;
  return `${prefix(context)} event unknown`;
}

export function formatTerminalText(text, context = {}) {
  return formatModelMessage(text, context);
}
