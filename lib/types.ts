/**
 * Types for Solid Model Context Protocol implementation
 */

/**
 * Configuration for connecting to a Solid Pod
 */
export interface SolidPodConfig {
  /**
   * The URL of the Solid Pod
   */
  podUrl: string;
  
  /**
   * Authentication token or credentials (optional)
   */
  auth?: {
    type: 'bearer' | 'dpop' | 'cookie';
    token?: string;
    refreshToken?: string;
  };
  
  /**
   * Custom fetch implementation (optional)
   */
  fetch?: typeof fetch;
}

/**
 * Resource metadata from a Solid Pod
 */
export interface SolidResource {
  /**
   * Resource URI
   */
  uri: string;
  
  /**
   * Resource type
   */
  type: 'container' | 'resource';
  
  /**
   * MIME type (for resources)
   */
  contentType?: string;
  
  /**
   * Last modified date
   */
  modified?: string;
  
  /**
   * Resource size in bytes
   */
  size?: number;
  
  /**
   * Access permissions
   */
  permissions?: {
    read: boolean;
    write: boolean;
    append: boolean;
    control: boolean;
  };
}

/**
 * Response from a Solid Pod resource query
 */
export interface SolidResourceResponse {
  /**
   * The requested resource
   */
  resource: SolidResource;
  
  /**
   * Content of the resource (if applicable)
   */
  content?: string | Blob | any;
  
  /**
   * Children resources (for containers)
   */
  children?: SolidResource[];
}

/**
 * MCP Service definition for Solid integration
 */
export interface SolidMCPService {
  /**
   * Service metadata
   */
  metadata: {
    name: string;
    description: string;
    version: string;
    capabilities: string[];
  };
  
  /**
   * Available tools
   */
  tools: SolidMCPTool[];
}

/**
 * MCP Tool definition for Solid operations
 */
export interface SolidMCPTool {
  /**
   * Tool name
   */
  name: string;
  
  /**
   * Tool description
   */
  description: string;
  
  /**
   * Tool input schema
   */
  input_schema: any;
  
  /**
   * Tool output schema
   */
  output_schema: any;
  
  /**
   * Function to execute
   */
  execute: (params: any) => Promise<any>;
} 