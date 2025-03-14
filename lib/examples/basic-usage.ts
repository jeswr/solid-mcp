/**
 * Example usage of the Solid MCP integration
 */
import { createSolidMCPServer, SolidMCPServer, SolidPodConfig } from '../';

/**
 * Example function to create a Solid MCP server
 */
async function createExampleServer(): Promise<SolidMCPServer> {
  // Configuration for connecting to a Solid Pod
  const config: SolidPodConfig = {
    podUrl: 'https://example.solidcommunity.net/',
    // For a real implementation, you would include authentication
    auth: {
      type: 'bearer',
      token: 'your-solid-access-token',
    }
  };

  // Create the MCP server
  return createSolidMCPServer(config);
}

/**
 * Example function to read a resource from a Solid Pod
 */
async function readResourceExample(server: SolidMCPServer): Promise<void> {
  console.log('Reading a resource from a Solid Pod...');
  
  // Example MCP request to read a resource
  const request = {
    action: 'read_resource',
    parameters: {
      uri: '/profile/card',
      include_content: true,
    },
  };
  
  try {
    // Handle the request
    const response = await server.handleRequest(request);
    
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example function to write a resource to a Solid Pod
 */
async function writeResourceExample(server: SolidMCPServer): Promise<void> {
  console.log('Writing a resource to a Solid Pod...');
  
  // Example MCP request to write a resource
  const request = {
    action: 'write_resource',
    parameters: {
      uri: '/examples/hello.txt',
      content: 'Hello, Solid World!',
      content_type: 'text/plain',
    },
  };
  
  try {
    // Handle the request
    const response = await server.handleRequest(request);
    
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example function to list the contents of a container
 */
async function listContainerExample(server: SolidMCPServer): Promise<void> {
  console.log('Listing container contents...');
  
  // Example MCP request to list a container
  const request = {
    action: 'list_container',
    parameters: {
      uri: '/examples/',
    },
  };
  
  try {
    // Handle the request
    const response = await server.handleRequest(request);
    
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example function to search for resources
 */
async function searchResourcesExample(server: SolidMCPServer): Promise<void> {
  console.log('Searching for resources...');
  
  // Example MCP request to search for resources
  const request = {
    action: 'search',
    parameters: {
      container_uri: '/',
      search_term: 'profile',
      recursive: true,
    },
  };
  
  try {
    // Handle the request
    const response = await server.handleRequest(request);
    
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Main function to run all examples
 */
async function runExamples(): Promise<void> {
  try {
    // Create the MCP server
    const server = await createExampleServer();
    
    // Run the examples
    await readResourceExample(server);
    await writeResourceExample(server);
    await listContainerExample(server);
    await searchResourcesExample(server);
    
    console.log('All examples completed successfully.');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run the examples
if (require.main === module) {
  runExamples().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export {
  createExampleServer,
  readResourceExample,
  writeResourceExample,
  listContainerExample,
  searchResourcesExample,
  runExamples,
}; 