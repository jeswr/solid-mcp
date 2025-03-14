import { SolidPodConfig, SolidResource, SolidResourceResponse } from './types';
import { normalizeUrl, parseResourceMetadata } from './utils';

/**
 * Client for interacting with a Solid Pod
 */
export class SolidClient {
  private config: SolidPodConfig;
  private fetchFn: typeof fetch;

  /**
   * Create a new SolidClient
   * 
   * @param config Configuration for connecting to a Solid Pod
   */
  constructor(config: SolidPodConfig) {
    this.config = config;
    this.fetchFn = config.fetch || fetch;
  }

  /**
   * Get the headers required for authentication
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/ld+json, application/json, text/turtle',
    };

    if (this.config.auth) {
      if (this.config.auth.type === 'bearer' && this.config.auth.token) {
        headers['Authorization'] = `Bearer ${this.config.auth.token}`;
      } else if (this.config.auth.type === 'dpop' && this.config.auth.token) {
        // DPoP authentication would require additional JWT handling
        headers['Authorization'] = `DPoP ${this.config.auth.token}`;
        // For a complete implementation, we would need to include DPoP headers
      }
    }

    return headers;
  }

  /**
   * Read a resource from the Solid Pod
   * 
   * @param uri URI of the resource to read
   * @param includeContent Whether to include the content of the resource
   * @returns Promise resolving to the resource response
   */
  async readResource(uri: string, includeContent: boolean = true): Promise<SolidResourceResponse> {
    const resourceUrl = normalizeUrl(uri, this.config.podUrl);
    
    try {
      const response = await this.fetchFn(resourceUrl, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to read resource: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('Content-Type') || '';
      const lastModified = response.headers.get('Last-Modified') || '';
      const contentLength = response.headers.get('Content-Length');
      const isContainer = contentType.includes('text/turtle') && await this.isContainer(response);

      const resource: SolidResource = {
        uri: resourceUrl,
        type: isContainer ? 'container' : 'resource',
        contentType: contentType,
        modified: lastModified,
        size: contentLength ? parseInt(contentLength, 10) : undefined,
        permissions: await this.getPermissions(resourceUrl),
      };

      const result: SolidResourceResponse = { resource };

      if (includeContent) {
        if (contentType.includes('application/json') || contentType.includes('application/ld+json')) {
          result.content = await response.json();
        } else if (contentType.includes('text/')) {
          result.content = await response.text();
        } else {
          result.content = await response.blob();
        }
      }

      if (isContainer) {
        result.children = await this.listContainerContents(resourceUrl);
      }

      return result;
    } catch (error) {
      throw new Error(`Error reading resource ${resourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a resource is a container
   * 
   * @param response The HTTP response
   * @returns Promise resolving to true if the resource is a container
   */
  private async isContainer(response: Response): Promise<boolean> {
    const body = await response.text();
    // This is a simplistic check; a proper implementation would use a
    // RDF parser to check if the resource is a ldp:Container
    return body.includes('http://www.w3.org/ns/ldp#Container');
  }

  /**
   * List the contents of a container
   * 
   * @param containerUrl URL of the container
   * @returns Promise resolving to an array of resources
   */
  private async listContainerContents(containerUrl: string): Promise<SolidResource[]> {
    try {
      const response = await this.fetchFn(containerUrl, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list container contents: ${response.status} ${response.statusText}`);
      }

      const body = await response.text();
      // In a full implementation, we would parse the RDF (Turtle) content
      // This is a placeholder for demonstration purposes
      return parseResourceMetadata(body, containerUrl);
    } catch (error) {
      throw new Error(`Error listing container contents: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the permissions for a resource
   * 
   * @param resourceUrl URL of the resource
   * @returns Promise resolving to the permissions or undefined
   */
  private async getPermissions(resourceUrl: string): Promise<SolidResource['permissions'] | undefined> {
    try {
      // In a real implementation, we would make a HEAD request and check the WAC-Allow header
      // This is a placeholder for demonstration purposes
      return {
        read: true,
        write: true,
        append: true,
        control: false,
      };
    } catch (error) {
      console.error(`Error fetching permissions: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Create or update a resource in the Solid Pod
   * 
   * @param uri URI of the resource to write
   * @param content Content to write
   * @param contentType Content type of the resource
   * @returns Promise resolving to the updated resource
   */
  async writeResource(uri: string, content: string | Blob | any, contentType: string): Promise<SolidResourceResponse> {
    const resourceUrl = normalizeUrl(uri, this.config.podUrl);
    
    try {
      const headers = this.getAuthHeaders();
      headers['Content-Type'] = contentType;

      let body: string | Blob;
      if (typeof content === 'string') {
        body = content;
      } else if (content instanceof Blob) {
        body = content;
      } else {
        body = JSON.stringify(content);
        headers['Content-Type'] = 'application/json';
      }

      const response = await this.fetchFn(resourceUrl, {
        method: 'PUT',
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`Failed to write resource: ${response.status} ${response.statusText}`);
      }

      // After successful write, read the resource to return the updated state
      return this.readResource(resourceUrl);
    } catch (error) {
      throw new Error(`Error writing resource ${resourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a resource from the Solid Pod
   * 
   * @param uri URI of the resource to delete
   * @returns Promise resolving to a success boolean
   */
  async deleteResource(uri: string): Promise<boolean> {
    const resourceUrl = normalizeUrl(uri, this.config.podUrl);
    
    try {
      const response = await this.fetchFn(resourceUrl, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete resource: ${response.status} ${response.statusText}`);
      }

      return true;
    } catch (error) {
      throw new Error(`Error deleting resource ${resourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a container in the Solid Pod
   * 
   * @param uri URI of the container to create
   * @returns Promise resolving to the created container
   */
  async createContainer(uri: string): Promise<SolidResourceResponse> {
    const containerUrl = normalizeUrl(uri, this.config.podUrl);
    
    try {
      const headers = this.getAuthHeaders();
      headers['Link'] = '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"';
      headers['Content-Type'] = 'text/turtle';

      const response = await this.fetchFn(containerUrl, {
        method: 'PUT',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to create container: ${response.status} ${response.statusText}`);
      }

      // After successful creation, read the container to return its state
      return this.readResource(containerUrl);
    } catch (error) {
      throw new Error(`Error creating container ${containerUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 