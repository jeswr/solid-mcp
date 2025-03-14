/**
 * Adapter to connect the Solid MCP implementation with the
 * official Model Context Protocol TypeScript SDK
 * 
 * Note: This is a demonstration of how to use the Model Context Protocol SDK
 * with your existing Solid MCP implementation, and may require further adaptation
 * for production use.
 */
import { 
  McpServer, 
  ResourceTemplate,
  ResourceKind,
  ResourceInfo
} from '@modelcontextprotocol/sdk';
import { HttpServerTransport } from '@modelcontextprotocol/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk';

import { SolidClient, SolidPodConfig, createSolidMCPServer } from './index';

/**
 * Configuration for the MCP adapter
 */
export interface SolidMcpAdapterConfig {
  /** Configuration for the Solid Pod */
  solidConfig: SolidPodConfig;
  /** Server information */
  serverInfo?: {
    name?: string;
    version?: string;
    description?: string;
  };
  /** Port for HTTP transport (if using HTTP) */
  httpPort?: number;
  /** Whether to use stdio for transport instead of HTTP */
  useStdio?: boolean;
}

/**
 * Creates an MCP server adapter that wraps the Solid MCP implementation
 * and exposes it through the official MCP TypeScript SDK.
 */
export async function createSolidMcpAdapter(config: SolidMcpAdapterConfig) {
  // Create Solid client
  const solidClient = new SolidClient(config.solidConfig);
  
  // Create our existing Solid MCP server implementation
  const solidMcpServer = createSolidMCPServer(config.solidConfig);
  
  // Create an MCP server using the official SDK
  const server = new McpServer({
    name: config.serverInfo?.name || "Solid MCP Server",
    version: config.serverInfo?.version || "1.0.0",
    description: config.serverInfo?.description || "An MCP server that exposes Solid resources"
  });

  // Define a resource template
  const resourceTemplate = new ResourceTemplate("solid://{path*}");
  
  // Register the resource template
  server.registerResourceKind("solid-resource", resourceTemplate);
  
  // Add resource handlers
  server.registerResourceHandler({
    kind: "solid-resource",
    
    // Read resource handler
    async read(uri: URL) {
      try {
        // Extract path from URI
        const path = uri.pathname.replace(/^\//, '');
        
        // Convert the MCP URI to a Solid path
        const solidPath = `/${path || ''}`;
        
        // Use our existing Solid MCP server
        const response = await solidMcpServer.handleRequest({
          action: 'read_resource',
          parameters: {
            uri: solidPath,
            include_content: true
          }
        });
        
        if (response.status === 'error') {
          throw new Error(response.error);
        }
        
        // Create resource info
        const info: ResourceInfo = {
          uri: uri.toString(),
          contentType: response.result.resource.contentType
        };
        
        // Return the resource with content
        return {
          info,
          content: response.result.content as string
        };
      } catch (error) {
        console.error('Error reading Solid resource:', error);
        throw new Error(`Failed to read Solid resource: ${error}`);
      }
    },
    
    // List resource children
    async list(uri: URL) {
      try {
        // Extract path from URI
        const path = uri.pathname.replace(/^\//, '');
        
        // Convert the MCP URI to a Solid path
        const solidPath = `/${path || ''}`;
        
        // Use our existing Solid MCP server
        const response = await solidMcpServer.handleRequest({
          action: 'list_container',
          parameters: {
            uri: solidPath
          }
        });
        
        if (response.status === 'error') {
          throw new Error(response.error);
        }
        
        // Format the response for MCP
        return {
          resources: response.result.children.map((child: any) => ({
            uri: `solid://${child.uri.replace(/^\//, '')}`,
            name: child.uri.split('/').pop() || '',
            isContainer: child.type === 'container'
          }))
        };
      } catch (error) {
        console.error('Error listing Solid container:', error);
        throw new Error(`Failed to list Solid container: ${error}`);
      }
    },
    
    // Write resource
    async write(uri: URL, content: string, contentType?: string) {
      try {
        // Extract path from URI
        const path = uri.pathname.replace(/^\//, '');
        
        // Convert the MCP URI to a Solid path
        const solidPath = `/${path || ''}`;
        
        // Use our existing Solid MCP server
        const response = await solidMcpServer.handleRequest({
          action: 'write_resource',
          parameters: {
            uri: solidPath,
            content: content,
            content_type: contentType || 'text/plain'
          }
        });
        
        if (response.status === 'error') {
          throw new Error(response.error);
        }
        
        // Return success
        return {
          uri: uri.toString()
        };
      } catch (error) {
        console.error('Error writing Solid resource:', error);
        throw new Error(`Failed to write Solid resource: ${error}`);
      }
    },
    
    // Delete resource
    async delete(uri: URL) {
      try {
        // Extract path from URI
        const path = uri.pathname.replace(/^\//, '');
        
        // Convert the MCP URI to a Solid path
        const solidPath = `/${path || ''}`;
        
        // Use our existing Solid MCP server
        const response = await solidMcpServer.handleRequest({
          action: 'delete_resource',
          parameters: {
            uri: solidPath
          }
        });
        
        if (response.status === 'error') {
          throw new Error(response.error);
        }
        
        // Return success
        return {};
      } catch (error) {
        console.error('Error deleting Solid resource:', error);
        throw new Error(`Failed to delete Solid resource: ${error}`);
      }
    }
  });
  
  // Register search handler
  server.registerSearchHandler({
    resourceKind: "solid-resource",
    async search(query: string, options: { containerUri?: string; recursive?: boolean }) {
      try {
        // Use our existing Solid MCP server
        const containerPath = options.containerUri 
          ? new URL(options.containerUri).pathname 
          : '/';
          
        const response = await solidMcpServer.handleRequest({
          action: 'search',
          parameters: {
            container_uri: containerPath,
            search_term: query,
            recursive: options.recursive || false
          }
        });
        
        if (response.status === 'error') {
          throw new Error(response.error);
        }
        
        // Format the response for MCP
        return {
          results: response.result.results.map((item: any) => ({
            uri: `solid://${item.uri.replace(/^\//, '')}`,
            name: item.uri.split('/').pop() || '',
            excerpt: item.excerpt || '',
            isContainer: item.type === 'container'
          }))
        };
      } catch (error) {
        console.error('Error searching Solid resources:', error);
        throw new Error(`Failed to search Solid resources: ${error}`);
      }
    }
  });
  
  // Create a transport
  let transport;
  if (config.useStdio) {
    transport = new StdioServerTransport();
  } else {
    transport = new HttpServerTransport({ port: config.httpPort || 3000 });
  }
  
  // Connect the server to the transport
  await server.connect(transport);
  
  return {
    server,
    transport,
    stop: async () => {
      await transport.close();
    }
  };
}

/**
 * Example usage:
 * 
 * ```typescript
 * import { createSolidMcpAdapter } from './mcp-adapter';
 * 
 * const adapter = await createSolidMcpAdapter({
 *   solidConfig: {
 *     podUrl: 'https://example.solidcommunity.net',
 *     fetch: fetch // Use a real fetch implementation
 *   },
 *   httpPort: 3000
 * });
 * 
 * console.log('Solid MCP Server is running on http://localhost:3000');
 * ```
 */ 