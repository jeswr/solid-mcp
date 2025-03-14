import { SolidClient } from './client';
import { SolidMCPService, SolidMCPTool, SolidPodConfig } from './types';
import { getFilenameFromUrl, isValidUrl } from './utils';

/**
 * MCP Server for Solid Pod integration
 */
export class SolidMCPServer {
  private client: SolidClient;
  private service: SolidMCPService;

  /**
   * Create a new SolidMCPServer
   * 
   * @param config Configuration for connecting to a Solid Pod
   */
  constructor(config: SolidPodConfig) {
    this.client = new SolidClient(config);
    
    // Define the MCP service
    this.service = {
      metadata: {
        name: 'solid-mcp',
        description: 'Anthropic Model Context Protocol integration for Solid pods',
        version: '1.0.0',
        capabilities: [
          'read_resource', 
          'write_resource', 
          'delete_resource', 
          'list_container', 
          'create_container'
        ],
      },
      tools: this.createTools(),
    };
  }

  /**
   * Create the MCP tools
   * 
   * @returns Array of MCP tools
   */
  private createTools(): SolidMCPTool[] {
    return [
      // Read Resource Tool
      {
        name: 'read_resource',
        description: 'Read a resource from a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['uri'],
          properties: {
            uri: {
              type: 'string',
              description: 'URI of the resource to read',
            },
            include_content: {
              type: 'boolean',
              description: 'Whether to include the content of the resource',
              default: true,
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            resource: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                type: { type: 'string', enum: ['container', 'resource'] },
                contentType: { type: 'string' },
                modified: { type: 'string' },
                size: { type: 'number' },
                permissions: {
                  type: 'object',
                  properties: {
                    read: { type: 'boolean' },
                    write: { type: 'boolean' },
                    append: { type: 'boolean' },
                    control: { type: 'boolean' },
                  },
                },
              },
            },
            content: { type: 'any' },
            children: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                  type: { type: 'string', enum: ['container', 'resource'] },
                  contentType: { type: 'string' },
                },
              },
            },
          },
        },
        execute: async (params: { uri: string; include_content?: boolean }) => {
          return await this.client.readResource(params.uri, params.include_content);
        },
      },
      
      // Write Resource Tool
      {
        name: 'write_resource',
        description: 'Create or update a resource in a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['uri', 'content', 'content_type'],
          properties: {
            uri: {
              type: 'string',
              description: 'URI of the resource to write',
            },
            content: {
              type: 'any',
              description: 'Content to write (string, object, or blob)',
            },
            content_type: {
              type: 'string',
              description: 'Content type of the resource',
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            resource: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                type: { type: 'string', enum: ['container', 'resource'] },
                contentType: { type: 'string' },
                modified: { type: 'string' },
                size: { type: 'number' },
              },
            },
          },
        },
        execute: async (params: { uri: string; content: any; content_type: string }) => {
          return await this.client.writeResource(params.uri, params.content, params.content_type);
        },
      },
      
      // Delete Resource Tool
      {
        name: 'delete_resource',
        description: 'Delete a resource from a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['uri'],
          properties: {
            uri: {
              type: 'string',
              description: 'URI of the resource to delete',
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        execute: async (params: { uri: string }) => {
          const success = await this.client.deleteResource(params.uri);
          return { success };
        },
      },
      
      // List Container Tool
      {
        name: 'list_container',
        description: 'List the contents of a container in a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['uri'],
          properties: {
            uri: {
              type: 'string',
              description: 'URI of the container to list',
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            container: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                type: { type: 'string', enum: ['container'] },
                contentType: { type: 'string' },
                modified: { type: 'string' },
              },
            },
            children: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                  type: { type: 'string', enum: ['container', 'resource'] },
                  contentType: { type: 'string' },
                },
              },
            },
          },
        },
        execute: async (params: { uri: string }) => {
          const result = await this.client.readResource(params.uri, false);
          return {
            container: result.resource,
            children: result.children || [],
          };
        },
      },
      
      // Create Container Tool
      {
        name: 'create_container',
        description: 'Create a container in a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['uri'],
          properties: {
            uri: {
              type: 'string',
              description: 'URI of the container to create',
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            container: {
              type: 'object',
              properties: {
                uri: { type: 'string' },
                type: { type: 'string', enum: ['container'] },
                contentType: { type: 'string' },
                modified: { type: 'string' },
              },
            },
          },
        },
        execute: async (params: { uri: string }) => {
          const result = await this.client.createContainer(params.uri);
          return {
            container: result.resource,
          };
        },
      },
      
      // Search Tool
      {
        name: 'search',
        description: 'Search for resources in a Solid Pod',
        input_schema: {
          type: 'object',
          required: ['container_uri', 'search_term'],
          properties: {
            container_uri: {
              type: 'string',
              description: 'URI of the container to search in',
            },
            search_term: {
              type: 'string',
              description: 'Term to search for',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to search recursively',
              default: false,
            },
          },
        },
        output_schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                  type: { type: 'string', enum: ['container', 'resource'] },
                  contentType: { type: 'string' },
                  relevance: { type: 'number' },
                },
              },
            },
          },
        },
        execute: async (params: { container_uri: string; search_term: string; recursive?: boolean }) => {
          // In a real implementation, we would perform a recursive search
          // This is a simplified example for demonstration purposes
          const results = await this.searchResources(
            params.container_uri, 
            params.search_term, 
            params.recursive || false
          );
          
          return { results };
        },
      },
    ];
  }

  /**
   * Search for resources in a container
   * 
   * @param containerUri URI of the container to search in
   * @param searchTerm Term to search for
   * @param recursive Whether to search recursively
   * @returns Promise resolving to an array of matching resources
   */
  private async searchResources(containerUri: string, searchTerm: string, recursive: boolean): Promise<any[]> {
    try {
      const result = await this.client.readResource(containerUri, false);
      
      if (!result.children || result.children.length === 0) {
        return [];
      }
      
      const searchResults = [];
      const lowerSearchTerm = searchTerm.toLowerCase();
      
      // Search in the current container
      for (const child of result.children) {
        const filename = getFilenameFromUrl(child.uri);
        const matchesFilename = filename.toLowerCase().includes(lowerSearchTerm);
        
        if (matchesFilename) {
          searchResults.push({
            ...child,
            relevance: 0.8, // Arbitrary relevance score
          });
        }
        
        // If recursive and child is a container, search inside it
        if (recursive && child.type === 'container') {
          const childResults = await this.searchResources(child.uri, searchTerm, recursive);
          searchResults.push(...childResults);
        }
      }
      
      // In a real implementation, we would also search inside file contents
      // For text and JSON files, for example
      
      return searchResults;
    } catch (error) {
      console.error(`Error searching resources: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Get the MCP Service definition
   * 
   * @returns The MCP Service definition
   */
  getService(): SolidMCPService {
    return this.service;
  }

  /**
   * Handle an MCP request
   * 
   * @param request MCP request
   * @returns Promise resolving to the response
   */
  async handleRequest(request: any): Promise<any> {
    try {
      // Validate the request
      if (!request.action || typeof request.action !== 'string') {
        throw new Error('Invalid request: missing or invalid action');
      }
      
      if (!request.parameters || typeof request.parameters !== 'object') {
        throw new Error('Invalid request: missing or invalid parameters');
      }
      
      // Find the tool that matches the action
      const tool = this.service.tools.find(t => t.name === request.action);
      
      if (!tool) {
        throw new Error(`Unknown action: ${request.action}`);
      }
      
      // Execute the tool
      const result = await tool.execute(request.parameters);
      
      return {
        status: 'success',
        result,
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Create an MCP server for a Solid Pod
 * 
 * @param config Configuration for connecting to a Solid Pod
 * @returns MCP server instance
 */
export function createSolidMCPServer(config: SolidPodConfig): SolidMCPServer {
  return new SolidMCPServer(config);
} 