/**
 * Example of using the Solid MCP adapter to run a real MCP server
 * 
 * Note: This is a demonstration of how to use the Model Context Protocol SDK
 * with your existing Solid MCP implementation, and may require further adaptation
 * for production use.
 */
import { createSolidMcpAdapter } from '../mcp-adapter';
import { SolidPodConfig } from '../index';

async function runAdapterExample() {
  console.log('Starting Solid MCP Adapter Example...');

  // Mock fetch implementation for the example
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
  };

  try {
    // Create a configuration for the Solid Pod
    const solidConfig: SolidPodConfig = {
      podUrl: 'https://example.solidcommunity.net',
      fetch: mockFetch as any,
    };

    // HTTP port for the server
    const httpPort = 3000;

    // Create the adapter
    const adapter = await createSolidMcpAdapter({
      solidConfig,
      httpPort,
      serverInfo: {
        name: "Solid MCP Server Example",
        version: "1.0.0",
        description: "An example MCP server exposing Solid resources"
      }
    });

    console.log(`Solid MCP Server is running on http://localhost:${httpPort}`);
    console.log('You can now use any MCP client to connect to this server');
    console.log('Press Ctrl+C to stop');
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      await adapter.stop();
      console.log('Server stopped');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error starting Solid MCP Server:', error);
    process.exit(1);
  }
}

// Run the adapter example
runAdapterExample().catch(console.error); 