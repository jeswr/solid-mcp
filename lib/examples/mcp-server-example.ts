/**
 * Example of creating an MCP server using the official Model Context Protocol TypeScript SDK 
 * to expose Solid resources
 * 
 * Note: This is a demonstration of how to use the Model Context Protocol SDK
 * with your existing Solid MCP implementation, and may require further adaptation
 * for production use.
 */
import { McpServer, ResourceTemplate, ResourceInfo } from '@modelcontextprotocol/sdk';
import { HttpServerTransport } from '@modelcontextprotocol/sdk';
import { SolidClient, SolidPodConfig } from '../index';

async function runServer() {
  console.log('Starting Solid MCP Server Example...');

  try {
    // Create a configuration for the Solid client
    const solidConfig: SolidPodConfig = {
      podUrl: 'https://example.solidcommunity.net',
      // You would use a real fetch implementation in production
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        console.log(`Would fetch ${input} with options:`, init);
        const url = input.toString();
        
        // Return mock data based on the URL
        if (url.includes('/profile/card')) {
          return new Response(
            `
              @prefix foaf: <http://xmlns.com/foaf/0.1/>.
              
              <https://example.solidcommunity.net/profile/card#me> a foaf:Person;
                foaf:name "Example User";
                foaf:mbox <mailto:user@example.org>.
            `, 
            { 
              status: 200, 
              headers: { 'Content-Type': 'text/turtle' } 
            }
          );
        } else if (url.includes('/notes/')) {
          return new Response(
            'This is a test note content',
            { 
              status: 200, 
              headers: { 'Content-Type': 'text/plain' } 
            }
          );
        } else if (init?.method === 'PUT') {
          return new Response(
            '',
            { 
              status: 201, 
              headers: { 'Location': url } 
            }
          );
        } else if (url.endsWith('/') || url.endsWith('/notes')) {
          return new Response(
            `
              @prefix ldp: <http://www.w3.org/ns/ldp#>.
              @prefix dc: <http://purl.org/dc/terms/>.
              
              <${url}> a ldp:Container;
                ldp:contains <${url}note1.txt>,
                            <${url}note2.txt>.
            `,
            { 
              status: 200, 
              headers: { 'Content-Type': 'text/turtle' } 
            }
          );
        } else {
          return new Response(
            'Not Found',
            { status: 404 }
          );
        }
      }
    };

    // Create a Solid client to interact with the Solid Pod
    const solidClient = new SolidClient(solidConfig);

    // Create an MCP server
    const server = new McpServer({
      name: "Solid MCP Server",
      version: "1.0.0",
      description: "An MCP server that exposes Solid resources"
    });

    // Create a resource template for Solid resources
    const resourceTemplate = new ResourceTemplate("solid://{path*}");
    
    // Register the resource kind
    server.registerResourceKind("solid-resource", resourceTemplate);
    
    // Register the resource handler
    server.registerResourceHandler({
      kind: "solid-resource",
      
      // Read resource implementation
      async read(uri: URL) {
        try {
          // Extract path from URI
          const path = uri.pathname.replace(/^\//, '');
          const solidPath = `/${path || ''}`;
          
          // Use the Solid client to read the resource
          const result = await solidClient.readResource(solidPath);
          
          // Create resource info
          const info: ResourceInfo = {
            uri: uri.toString(),
            contentType: result.resource.contentType
          };
          
          // Return the resource with content
          return {
            info,
            content: result.content as string
          };
        } catch (error) {
          console.error('Error reading Solid resource:', error);
          throw new Error(`Failed to read Solid resource: ${error}`);
        }
      },
      
      // List resources implementation (mock implementation since SolidClient does not have listContainer)
      async list(uri: URL) {
        try {
          // Extract path from URI
          const path = uri.pathname.replace(/^\//, '');
          const solidPath = `/${path || ''}`;
          
          // Simulate listing a container
          // In a real implementation, you would use a proper method to list the container
          console.log(`Would list container: ${solidPath}`);
          
          // Mock response
          return {
            resources: [
              {
                uri: `solid://${path}file1.txt`,
                name: 'file1.txt'
              },
              {
                uri: `solid://${path}file2.txt`,
                name: 'file2.txt'
              },
              {
                uri: `solid://${path}subdir/`,
                name: 'subdir',
                isContainer: true
              }
            ]
          };
        } catch (error) {
          console.error('Error listing Solid container:', error);
          throw new Error(`Failed to list Solid container: ${error}`);
        }
      },
      
      // Write resource implementation
      async write(uri: URL, content: string, contentType?: string) {
        try {
          // Extract path from URI
          const path = uri.pathname.replace(/^\//, '');
          const solidPath = `/${path || ''}`;
          
          // Use the Solid client to write the resource
          await solidClient.writeResource(solidPath, content, contentType || 'text/plain');
          
          // Return success with the URI
          return {
            uri: uri.toString()
          };
        } catch (error) {
          console.error('Error writing Solid resource:', error);
          throw new Error(`Failed to write Solid resource: ${error}`);
        }
      },
      
      // Delete resource implementation
      async delete(uri: URL) {
        try {
          // Extract path from URI
          const path = uri.pathname.replace(/^\//, '');
          const solidPath = `/${path || ''}`;
          
          // Use the Solid client to delete the resource
          await solidClient.deleteResource(solidPath);
          
          // Return empty success
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
          // Mock search functionality
          console.log(`Would search for "${query}" in container: ${options.containerUri || '/'} (recursive: ${options.recursive || false})`);
          
          // Return mock search results
          return {
            results: [
              {
                uri: 'solid:///profile/card',
                name: 'card',
                excerpt: `Found "${query}" in profile card`,
              },
              {
                uri: 'solid:///notes/note1.txt',
                name: 'note1.txt',
                excerpt: `Found "${query}" in note1`,
              }
            ]
          };
        } catch (error) {
          console.error('Error searching Solid resources:', error);
          throw new Error(`Failed to search Solid resources: ${error}`);
        }
      }
    });

    // Create an HTTP transport for the server (listen on port 3000)
    const transport = new HttpServerTransport({ port: 3000 });
    
    // Connect the server to the transport
    await server.connect(transport);
    
    console.log('Solid MCP Server is running on http://localhost:3000');
    console.log('Press Ctrl+C to stop');
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      await transport.close();
      console.log('Server stopped');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error starting Solid MCP Server:', error);
    process.exit(1);
  }
}

// Run the server
runServer().catch(console.error); 