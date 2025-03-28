/// <reference types="jest" />
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import fetch from 'cross-fetch';
import { SolidClient } from '../../lib/client';
import { SolidMCPServer, createSolidMCPServer } from '../../lib/server';
import { SolidPodConfig } from '../../lib/types';

describe('CSS Integration Tests', () => {
  let serverProcess: ChildProcess;
  let client: SolidClient;
  let mcpServer: SolidMCPServer;
  let tempDir: string;
  const baseUrl = 'http://localhost:3000';

  beforeAll(async () => {
    // Create a temporary directory for the server
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-mcp-test-'));
    const dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Start the Community Solid Server
    serverProcess = spawn('npx', [
      '@solid/community-server',
      '-c', 'memory',
      '-p', '3000',
      '--loggingLevel', 'error'
    ], {
      stdio: 'pipe',
      detached: false
    });

    // Wait for the server to start
    await new Promise<void>((resolve) => {
      const checkServer = async () => {
        try {
          await fetch(baseUrl);
          resolve();
        } catch (error) {
          setTimeout(checkServer, 500);
        }
      };
      checkServer();
    });

    // Initialize the client and MCP server
    const config: SolidPodConfig = {
      podUrl: baseUrl,
      fetch
    };
    
    client = new SolidClient(config);
    mcpServer = createSolidMCPServer(config);
  }, 30000); // Increase timeout for server startup

  afterAll(async () => {
    // Kill the server process
    if (serverProcess) {
      serverProcess.kill();
    }

    // Clean up the temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Create a container', async () => {
    const containerName = `test-container-${Date.now()}`;
    const request = {
      action: 'create_container',
      parameters: {
        uri: `/${containerName}/`,
      },
    };
    
    const response = await mcpServer.handleRequest(request);
    expect(response.status).toBe('success');
  });

  test('Write a resource', async () => {
    const resourceName = `test-resource-${Date.now()}.txt`;
    const content = 'Hello, world!';
    const contentType = 'text/plain';
    
    const request = {
      action: 'write_resource',
      parameters: {
        uri: `/${resourceName}`,
        content,
        content_type: contentType,
      },
    };
    
    const response = await mcpServer.handleRequest(request);
    expect(response.status).toBe('success');
  });

  test('Read a resource', async () => {
    const resourceName = `test-resource-${Date.now()}.txt`;
    const content = 'Hello, world!';
    const contentType = 'text/plain';
    
    // First write the resource
    const writeRequest = {
      action: 'write_resource',
      parameters: {
        uri: `/${resourceName}`,
        content,
        content_type: contentType,
      },
    };
    
    await mcpServer.handleRequest(writeRequest);
    
    // Then read it
    const readRequest = {
      action: 'read_resource',
      parameters: {
        uri: `/${resourceName}`,
        include_content: true,
      },
    };
    
    const response = await mcpServer.handleRequest(readRequest);
    expect(response.status).toBe('success');
    expect(response.result.content).toBe(content);
    expect(response.result.resource.contentType).toContain(contentType);
  });

  test('List container contents', async () => {
    const containerName = `test-container-${Date.now()}`;
    const resourceName = `test-resource-${Date.now()}.txt`;
    
    // Create container and resource
    const containerRequest = {
      action: 'create_container',
      parameters: {
        uri: `/${containerName}/`,
      },
    };
    
    await mcpServer.handleRequest(containerRequest);
    
    const writeRequest = {
      action: 'write_resource',
      parameters: {
        uri: `/${containerName}/${resourceName}`,
        content: 'test content',
        content_type: 'text/plain',
      },
    };
    
    await mcpServer.handleRequest(writeRequest);
    
    // List container contents
    const listRequest = {
      action: 'list_container',
      parameters: {
        uri: `/${containerName}/`,
      },
    };
    
    const response = await mcpServer.handleRequest(listRequest);
    expect(response.status).toBe('success');
    
    // Check that the resource is in the container
    const childUris = response.result.children.map((child: any) => child.uri);
    expect(childUris).toContain(`/${containerName}/${resourceName}`);
  });

  test('Delete a resource', async () => {
    const resourceName = `test-resource-to-delete-${Date.now()}.txt`;
    
    // First create the resource
    const writeRequest = {
      action: 'write_resource',
      parameters: {
        uri: `/${resourceName}`,
        content: 'delete me',
        content_type: 'text/plain',
      },
    };
    
    await mcpServer.handleRequest(writeRequest);
    
    // Then delete it
    const deleteRequest = {
      action: 'delete_resource',
      parameters: {
        uri: `/${resourceName}`,
      },
    };
    
    const deleteResponse = await mcpServer.handleRequest(deleteRequest);
    expect(deleteResponse.status).toBe('success');
    
    // Verify it's gone
    const readRequest = {
      action: 'read_resource',
      parameters: {
        uri: `/${resourceName}`,
        include_content: true,
      },
    };
    
    try {
      await mcpServer.handleRequest(readRequest);
      fail('Resource should not exist');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test('MCP adapter works with CSS server', async () => {
    const resourceName = `mcp-test-${Date.now()}.txt`;
    const content = 'MCP test content';
    
    // Test the MCP adapter with the CSS server
    const writeRequest = {
      action: 'write_resource',
      parameters: {
        uri: `/${resourceName}`,
        content,
        content_type: 'text/plain',
      },
    };
    
    const writeResponse = await mcpServer.handleRequest(writeRequest);
    expect(writeResponse.status).toBe('success');
    
    const readRequest = {
      action: 'read_resource',
      parameters: {
        uri: `/${resourceName}`,
        include_content: true,
      },
    };
    
    const readResponse = await mcpServer.handleRequest(readRequest);
    expect(readResponse.status).toBe('success');
    expect(readResponse.result.content).toBe(content);
    
    const deleteRequest = {
      action: 'delete_resource',
      parameters: {
        uri: `/${resourceName}`,
      },
    };
    
    const deleteResponse = await mcpServer.handleRequest(deleteRequest);
    expect(deleteResponse.status).toBe('success');
  });
}); 