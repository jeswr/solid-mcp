# solid-mcp

[![GitHub license](https://img.shields.io/github/license/jeswr/solid-mcp.svg)](https://github.com/jeswr/solid-mcp/blob/master/LICENSE)
[![npm version](https://img.shields.io/npm/v/@jeswr/solid-mcp.svg)](https://www.npmjs.com/package/@jeswr/solid-mcp)
[![build](https://img.shields.io/github/actions/workflow/status/jeswr/solid-mcp/nodejs.yml?branch=main)](https://github.com/jeswr/solid-mcp/tree/main/)
[![Dependabot](https://badgen.net/badge/Dependabot/enabled/green?icon=dependabot)](https://dependabot.com/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

Anthropic Model Context Protocol (MCP) integration for the Solid protocol.

This library enables AI models like Claude to access and manipulate data stored in Solid pods through the Model Context Protocol. It allows AI systems to read, write, search, and manage resources in Solid pods while respecting user privacy and control over their data.

## Features

- 🔄 Seamless integration between Anthropic's MCP and Solid pods
- 📁 Read and write resources in Solid pods
- 🔍 Search for resources and contents
- 📂 Create and manage containers
- 🔐 Authentication support for secure pod access
- 🧰 Tool-based API for integration with AI models
- 📊 Structured data handling

## Installation

```bash
npm install @jeswr/solid-mcp
```

## Usage

### Basic Setup

```typescript
import { createSolidMCPServer, SolidPodConfig } from '@jeswr/solid-mcp';

// Configure access to a Solid Pod
const config: SolidPodConfig = {
  podUrl: 'https://example.solidcommunity.net/',
  auth: {
    type: 'bearer',
    token: 'your-solid-access-token',
  }
};

// Create the MCP server
const server = createSolidMCPServer(config);
```

### Reading a Resource

```typescript
// Example MCP request to read a resource
const request = {
  action: 'read_resource',
  parameters: {
    uri: '/profile/card',
    include_content: true,
  },
};

// Handle the request
const response = await server.handleRequest(request);
console.log('Response:', response);
```

### Writing a Resource

```typescript
// Example MCP request to write a resource
const request = {
  action: 'write_resource',
  parameters: {
    uri: '/examples/hello.txt',
    content: 'Hello, Solid World!',
    content_type: 'text/plain',
  },
};

// Handle the request
const response = await server.handleRequest(request);
console.log('Response:', response);
```

### Listing Container Contents

```typescript
// Example MCP request to list a container
const request = {
  action: 'list_container',
  parameters: {
    uri: '/examples/',
  },
};

// Handle the request
const response = await server.handleRequest(request);
console.log('Response:', response);
```

### Searching for Resources

```typescript
// Example MCP request to search for resources
const request = {
  action: 'search',
  parameters: {
    container_uri: '/',
    search_term: 'profile',
    recursive: true,
  },
};

// Handle the request
const response = await server.handleRequest(request);
console.log('Response:', response);
```

## API Reference

### `createSolidMCPServer(config: SolidPodConfig): SolidMCPServer`

Creates a new MCP server for a Solid Pod.

### `SolidClient`

Client for interacting with a Solid Pod.

- `readResource(uri: string, includeContent?: boolean): Promise<SolidResourceResponse>`
- `writeResource(uri: string, content: any, contentType: string): Promise<SolidResourceResponse>`
- `deleteResource(uri: string): Promise<boolean>`
- `createContainer(uri: string): Promise<SolidResourceResponse>`

### `SolidMCPServer`

MCP server for Solid Pod integration.

- `handleRequest(request: any): Promise<any>`
- `getService(): SolidMCPService`

## Integration with Anthropic Claude

This library makes it easy to integrate Solid pods with Anthropic's Claude AI through the Model Context Protocol. Claude can access and manipulate data in Solid pods while respecting user privacy and control.

### Example Claude Integration

```typescript
// In your Claude MCP client implementation
const solidMCPServer = createSolidMCPServer({
  podUrl: 'https://example.solidcommunity.net/',
  auth: { type: 'bearer', token: 'your-solid-access-token' }
});

// When Claude needs to access data
const claudeRequest = {
  action: 'read_resource',
  parameters: { uri: '/notes/important.txt' }
};

const response = await solidMCPServer.handleRequest(claudeRequest);
// Provide the response to Claude for context
```

## Running Examples

The library includes example code showing how to use the various features:

```bash
npm run example
```

## License
©2025–present
[Jesse Wright](https://github.com/jeswr),
[MIT License](https://github.com/jeswr/solid-mcp/blob/master/LICENSE).
