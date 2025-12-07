/**
 * MCP (Model Context Protocol) Server Registry
 *
 * Add new MCPs here to make them available for installation.
 * Each MCP entry defines:
 * - name: Display name for the MCP
 * - description: Short description of what the MCP does
 * - command: The full claude mcp add command to install it
 * - npmPackage: The npm package name (for reference)
 * - category: Optional category for grouping
 */

export interface McpEntry {
  /** Category for grouping (e.g., 'browser', 'database', 'devtools') */
  category?: string;
  /** The full claude mcp add command arguments (after 'claude mcp add') */
  command: string;
  /** Short description of what the MCP does */
  description: string;
  /** Unique identifier for the MCP */
  id: string;
  /** Display name for the MCP */
  name: string;
  /** The npm package name (optional for remote MCPs) */
  npmPackage?: string;
  /** Transport type for remote MCPs ('http' or 'sse') */
  transport?: 'http' | 'sse';
  /** URL for more information */
  url?: string;
}

/**
 * Registry of available MCPs
 * Add new MCPs here to make them available via `lt claude install-mcps`
 */
export const MCP_REGISTRY: McpEntry[] = [
  {
    category: 'devtools',
    command: 'chrome-devtools -- npx chrome-devtools-mcp@latest',
    description: 'Chrome DevTools integration for debugging web applications',
    id: 'chrome-devtools',
    name: 'Chrome DevTools',
    npmPackage: 'chrome-devtools-mcp',
    url: 'https://www.npmjs.com/package/chrome-devtools-mcp',
  },
  {
    category: 'project-management',
    command: 'linear https://mcp.linear.app/mcp',
    description: 'Linear integration for issue tracking and project management',
    id: 'linear',
    name: 'Linear',
    transport: 'http',
    url: 'https://linear.app/docs/mcp',
  },
  // Add more MCPs here as needed:
  // {
  //   id: 'example-mcp',
  //   name: 'Example MCP',
  //   description: 'Description of what this MCP does',
  //   npmPackage: 'example-mcp-package',
  //   command: 'example-mcp -- npx example-mcp-package@latest',
  //   category: 'category-name',
  //   url: 'https://example.com',
  // },
];

/**
 * Get all available MCPs
 */
export function getAllMcps(): McpEntry[] {
  return MCP_REGISTRY;
}

/**
 * Get all unique categories
 */
export function getCategories(): string[] {
  const categories = MCP_REGISTRY
    .map(mcp => mcp.category)
    .filter((cat): cat is string => !!cat);
  return [...new Set(categories)];
}

/**
 * Get MCP by ID
 */
export function getMcpById(id: string): McpEntry | undefined {
  return MCP_REGISTRY.find(mcp => mcp.id === id);
}

/**
 * Get MCPs by category
 */
export function getMcpsByCategory(category: string): McpEntry[] {
  return MCP_REGISTRY.filter(mcp => mcp.category === category);
}
