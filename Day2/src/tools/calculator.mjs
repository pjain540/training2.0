import { Type } from '@google/genai';

/**
 * Gemini Function Declaration for the Calculator Tool.
 */
export const calculatorToolDeclaration = {
  name: 'calculator',
  description: 'Safely calculates mathematical and arithmetic expressions. Supports +, -, *, /, exponents (^ or **), percentages (e.g. "15% of 68373433" or "68373433 * 0.15"), and parentheses. Always use this tool for precise calculations.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      expression: {
        type: Type.STRING,
        description: 'The mathematical expression to evaluate (e.g., "68373433 * 0.15", "(45 + 55) / 2", "2 ^ 10").'
      }
    },
    required: ['expression']
  }
};

/**
 * Normalizes and sanitizes a mathematical string.
 * Transforms human expressions like "15% of 68,373,433" into standard executable arithmetic.
 *
 * @param {string} rawExpr
 * @returns {string} Sanitized arithmetic expression
 */
export function sanitizeMathExpression(rawExpr) {
  if (typeof rawExpr !== 'string' || !rawExpr.trim()) {
    throw new Error('Expression must be a non-empty string.');
  }

  let expr = rawExpr.trim();

  // 1. Remove commas in numbers (e.g. "68,373,433" -> "68373433")
  expr = expr.replace(/(\d),(\d)/g, '$1$2');

  // 2. Handle "X% of Y" -> "((X / 100) * Y)"
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of|\*)\s*(\d+(?:\.\d+)?)/gi, '(($1 / 100) * $2)');

  // 3. Handle trailing standalone percentages (e.g. "15%" -> "(15 / 100)")
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1 / 100)');

  // 4. Replace exponentiation operator "^" with JavaScript "**"
  expr = expr.replace(/\^/g, '**');

  // 5. Replace 'x' or 'X' with '*' when used between numbers (e.g. "5 x 10" -> "5 * 10")
  expr = expr.replace(/(\d)\s*[xX]\s*(\d)/g, '$1 * $2');

  // 6. Security guardrail: strict whitelist of permitted characters only
  const allowedCharsRegex = /^[\d+\-*/().\s]+$/;
  // Note: '**' was introduced in step 4, check with asterisk allowance
  if (!allowedCharsRegex.test(expr)) {
    throw new Error(`Security validation failed: Expression contains disallowed characters or commands: "${rawExpr}"`);
  }

  return expr;
}

/**
 * Executes safe mathematical evaluation using a controlled Function constructor
 * strictly restricted to sanitized arithmetic tokens.
 *
 * @param {Object} args
 * @param {string} args.expression - The arithmetic expression
 * @returns {Promise<{ expression: string, sanitized: string, result: number, formatted: string } | { error: string }>}
 */
export async function calculatorToolHandler(args) {
  const rawExpression = args?.expression;

  try {
    const sanitized = sanitizeMathExpression(rawExpression);

    // Evaluate in strict mode without access to global/window context
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const numResult = fn();

    if (typeof numResult !== 'number' || Number.isNaN(numResult)) {
      return {
        error: `Calculation resulted in an invalid number (NaN) for expression "${rawExpression}".`
      };
    }

    if (!Number.isFinite(numResult)) {
      return {
        error: `Calculation resulted in infinite value (likely division by zero) for expression "${rawExpression}".`
      };
    }

    // Format with locale commas if sensible
    const formatted = Number.isInteger(numResult)
      ? numResult.toLocaleString('en-US')
      : Number(numResult.toFixed(4)).toLocaleString('en-US');

    return {
      expression: rawExpression,
      sanitized,
      result: numResult,
      formatted
    };
  } catch (err) {
    return {
      error: `Failed to calculate "${rawExpression}": ${err.message}`
    };
  }
}
