const { ZodError } = require("zod");
const { createApiError } = require("./http");

function validate(schema, input) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw createApiError(400, "validation_error", "Request validation failed.", {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

function formatValidationMessage(error) {
  if (!(error instanceof ZodError) && !Array.isArray(error?.details?.issues)) {
    return null;
  }

  const issues = error instanceof ZodError ? error.issues : error.details.issues;
  if (!issues.length) {
    return "Request validation failed.";
  }

  return issues
    .map((issue) => {
      const prefix = issue.path ? `${issue.path}: ` : "";
      return `${prefix}${issue.message}`;
    })
    .join(" ");
}

module.exports = {
  formatValidationMessage,
  validate,
};
