/**
 * Example of using the official Model Context Protocol TypeScript SDK with Solid MCP
 * 
 * Note: This is a demonstration of how to use the Model Context Protocol SDK
 * with your existing Solid MCP implementation, and may require further adaptation
 * for production use.
 */
import { McpClient } from '@modelcontextprotocol/sdk';
import { BrowserClientTransport } from '@modelcontextprotocol/sdk';
import { createSolidMCPServer, SolidPodConfig } from '../index';

// This example shows how to use the MCP TypeScript SDK to interact with our Solid MCP implementation

async function runExample() {
  console.log('Starting MCP Client Example with Solid MCP...');

  try {
    // Create a Solid MCP server with example configuration
    const solidConfig: SolidPodConfig = {
      podUrl: 'https://example.solidcommunity.net',
      // For this example, we use fetch but don't actually make network calls
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        console.log(`Would fetch ${input} with options:`, init);
        return new Response(
          JSON.stringify({ message: 'Mock response' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    };

    // Create our Solid MCP server
    const solidMcpServer = createSolidMCPServer(solidConfig);

    // Initialize an MCP client using a browser transport
    // Note: In a server environment, you might use a different transport
    const transport = new BrowserClientTransport();
    const client = new McpClient();

    // Connect to our Solid MCP server
    // In a real application, the client and server would be separate processes
    // communicating over a transport mechanism
    // For this example, we'll manually handle the communication between them
    
    // Start the client
    await client.connect(transport);
    
    // Hook up the client's outbound messages to the server
    transport.onMessage.addListener(async (messageString: string) => {
      // Log the message from client to server
      console.log('Client -> Server:', messageString);
      
      // Process the message with our Solid MCP server
      const message = JSON.parse(messageString);
      const response = await solidMcpServer.handleRequest(message);
      
      // Send the response back to the client
      transport.receiveMessage(JSON.stringify(response));
    });

    // Use the client to read a resource
    console.log('Requesting to read a resource...');
    const readResponse = await client.fetchResource('solid:///profile/card');
    console.log('Read response:', readResponse);

    // Use the client to list a container
    console.log('Requesting to list a container...');
    const listResponse = await client.listResources('solid:///');
    console.log('List response:', listResponse);

    // Use the client to write a resource
    console.log('Requesting to write a resource...');
    const writeResponse = await client.writeResource('solid:///notes/new-note.txt', 'This is a test note', 'text/plain');
    console.log('Write response:', writeResponse);

    // Use the client to search
    console.log('Requesting to search...');
    const searchResponse = await client.search('profile', { containerUri: 'solid:///', recursive: true });
    console.log('Search response:', searchResponse);

    console.log('MCP Client Example completed successfully.');
  } catch (error) {
    console.error('Error in MCP Client Example:', error);
  }
}

// Run the example
runExample().catch(console.error); 