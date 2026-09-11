import { calculatorToolDeclaration, calculatorToolHandler } from './calculator.mjs';
import { searchToolDeclaration, searchToolHandler } from './search.mjs';

/**
 * Registry and dispatcher for agent tools.
 * Isolates tool execution, schema management, and error boundaries.
 */
export class ToolRegistry {
  constructor() {
    /** @type {Map<string, { declaration: Object, handler: Function }>} */
    this.tools = new Map();
  }

  /**
   * Registers a tool with its Gemini function declaration schema and execution handler.
   *
   * @param {Object} declaration - Gemini Type schema declaration
   * @param {Function} handler - Async function executing the tool logic
   * @returns {ToolRegistry} this instance for chaining
   */
  register(declaration, handler) {
    if (!declaration?.name) {
      throw new Error('Tool declaration must have a valid "name" property.');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Handler for tool "${declaration.name}" must be a function.`);
    }

    this.tools.set(declaration.name, {
      declaration,
      handler
    });

    return this;
  }

  /**
   * Checks if a tool is registered.
   *
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Retrieves all registered function declarations formatted for the Gemini API.
   *
   * @returns {Array<Object>} List of function declarations
   */
  getFunctionDeclarations() {
    return Array.from(this.tools.values()).map(t => t.declaration);
  }

  /**
   * Dispatches and executes a tool call by name with safe error boundaries.
   * Any handler exception is caught and wrapped so the model can inspect and self-correct.
   *
   * @param {string} name - Name of the tool to execute
   * @param {Object} args - Arguments passed by the model
   * @returns {Promise<Object>} Execution result object
   */
  async execute(name, args = {}) {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        error: `Tool "${name}" is not registered. Available tools: ${Array.from(this.tools.keys()).join(', ')}`
      };
    }

    try {
      const result = await tool.handler(args);
      return result;
    } catch (err) {
      return {
        error: `Error executing tool "${name}": ${err.message}`
      };
    }
  }

  /**
   * Returns a list of tool names and descriptions.
   */
  list() {
    return Array.from(this.tools.entries()).map(([name, item]) => ({
      name,
      description: item.declaration.description
    }));
  }

  /**
   * Factory that creates a registry preloaded with the default Day 2 tools
   * (calculator + search_web).
   *
   * @returns {ToolRegistry}
   */
  static createDefault() {
    const registry = new ToolRegistry();
    registry.register(calculatorToolDeclaration, calculatorToolHandler);
    registry.register(searchToolDeclaration, searchToolHandler);
    return registry;
  }
}
