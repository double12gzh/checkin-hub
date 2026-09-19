#!/usr/bin/env node

/**
 * bin/checkin-hub.js
 *
 * Global CLI executable for CheckinHub.
 * Enables running checkins directly from any terminal or calling MCP server via --mcp.
 */

const args = process.argv.slice(2);

if (args.includes('--mcp')) {
  const { startStdioServer } = require('../mcp-server');
  startStdioServer();
} else {
  require('../index');
}
