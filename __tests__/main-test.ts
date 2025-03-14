/// <reference types="jest" />
import { createSolidMCPServer, SolidPodConfig } from '../lib';

// Declare the global fetch mock for TypeScript
declare const global: {
  fetch: jest.Mock;
};

// Mock fetch implementation for testing
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({
    'Content-Type': 'text/turtle',
    'Last-Modified': 'Tue, 05 Dec 2023 12:00:00 GMT',
    'Content-Length': '1024',
  }),
  text: () => Promise.resolve(`
    @prefix ldp: <http://www.w3.org/ns/ldp#>.
    @prefix dc: <http://purl.org/dc/terms/>.
    
    <https://example.solidcommunity.net/> a ldp:Container;
      ldp:contains <https://example.solidcommunity.net/profile/>,
                  <https://example.solidcommunity.net/inbox/>.
    
    <https://example.solidcommunity.net/profile/> a ldp:Container;
      dc:format "text/turtle".
    
    <https://example.solidcommunity.net/inbox/> a ldp:Container;
      dc:format "text/turtle".
  `),
  json: () => Promise.resolve({}),
  blob: () => Promise.resolve(new Blob()),
}));

describe('Solid MCP Integration', () => {
  let server: any;
  
  beforeEach(() => {
    // Reset mock
    (global.fetch as jest.Mock).mockClear();
    
    // Create a server with a test configuration
    const config: SolidPodConfig = {
      podUrl: 'https://example.solidcommunity.net/',
      fetch: global.fetch as any, // Use the mock fetch
    };
    
    server = createSolidMCPServer(config);
  });
  
  it('should create a server instance', () => {
    expect(server).toBeDefined();
    expect(server.getService()).toBeDefined();
    expect(server.getService().metadata.name).toBe('solid-mcp');
  });
  
  it('should handle read_resource requests', async () => {
    const request = {
      action: 'read_resource',
      parameters: {
        uri: '/profile/card',
        include_content: true,
      },
    };
    
    const response = await server.handleRequest(request);
    
    expect(response.status).toBe('success');
    expect(response.result.resource).toBeDefined();
    expect(response.result.resource.uri).toContain('/profile/card');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  
  it('should handle errors gracefully', async () => {
    // Temporarily make fetch fail
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    
    const request = {
      action: 'read_resource',
      parameters: {
        uri: '/profile/card',
      },
    };
    
    const response = await server.handleRequest(request);
    
    expect(response.status).toBe('error');
    expect(response.error).toBeDefined();
    expect(response.error).toContain('Network error');
  });
  
  it('should reject invalid requests', async () => {
    const request = {
      // Missing action
      parameters: {
        uri: '/profile/card',
      },
    };
    
    const response = await server.handleRequest(request as any);
    
    expect(response.status).toBe('error');
    expect(response.error).toContain('Invalid request');
  });
  
  it('should reject unknown actions', async () => {
    const request = {
      action: 'unknown_action',
      parameters: {
        uri: '/profile/card',
      },
    };
    
    const response = await server.handleRequest(request);
    
    expect(response.status).toBe('error');
    expect(response.error).toContain('Unknown action');
  });
});
