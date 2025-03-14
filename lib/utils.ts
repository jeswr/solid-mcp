import { SolidResource } from './types';

/**
 * Normalize a URI against a base URL
 * 
 * @param uri URI to normalize
 * @param baseUrl Base URL to use for relative URIs
 * @returns Normalized URI
 */
export function normalizeUrl(uri: string, baseUrl: string): string {
  try {
    // Check if the URI is already absolute
    new URL(uri);
    return uri;
  } catch (e) {
    // If it's relative, append it to the base URL
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const path = uri.startsWith('/') ? uri.substring(1) : uri;
    return `${base}${path}`;
  }
}

/**
 * Parse resource metadata from Turtle RDF
 * 
 * @param turtleContent Turtle RDF content
 * @param containerUrl URL of the container
 * @returns Array of resources
 */
export function parseResourceMetadata(turtleContent: string, containerUrl: string): SolidResource[] {
  // In a real implementation, we would use a proper RDF parser
  // This is a simplified example for demonstration purposes
  
  const resources: SolidResource[] = [];
  
  // Sample parsing logic for Turtle RDF content
  // This is a very simplified approach and would need a proper RDF parser in production
  const lines = turtleContent.split('\n');
  
  // Keep track of the current subject
  let currentUri = '';
  let isContainer = false;
  let contentType = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Look for resource URIs
    if (trimmedLine.includes('<http') && trimmedLine.includes('>')) {
      const uriMatch = trimmedLine.match(/<([^>]+)>/);
      if (uriMatch && uriMatch[1]) {
        currentUri = uriMatch[1];
        isContainer = false;
        contentType = '';
      }
    }
    
    // Check if it's a container
    if (trimmedLine.includes('http://www.w3.org/ns/ldp#Container')) {
      isContainer = true;
    }
    
    // Look for content type
    if (trimmedLine.includes('http://purl.org/dc/terms/format')) {
      const contentTypeMatch = trimmedLine.match(/"([^"]+)"/);
      if (contentTypeMatch && contentTypeMatch[1]) {
        contentType = contentTypeMatch[1];
      }
    }
    
    // If we've found a new resource, add it to the list
    if (currentUri && (
      trimmedLine.endsWith('.') || 
      trimmedLine.endsWith(';') || 
      trimmedLine === '')
    ) {
      // Skip the container itself
      if (currentUri !== containerUrl && currentUri) {
        resources.push({
          uri: currentUri,
          type: isContainer ? 'container' : 'resource',
          contentType: contentType || undefined,
        });
      }
      
      // Reset for the next resource
      currentUri = '';
    }
  }
  
  return resources;
}

/**
 * Check if a string is a valid URL
 * 
 * @param url String to check
 * @returns Whether the string is a valid URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Extract the filename from a URL
 * 
 * @param url URL to extract from
 * @returns Filename
 */
export function getFilenameFromUrl(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  return pathParts[pathParts.length - 1] || '';
}

/**
 * Get the parent container URL
 * 
 * @param url URL to get parent of
 * @returns Parent container URL
 */
export function getParentContainerUrl(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  
  // Remove the last part (filename or empty string)
  pathParts.pop();
  
  // Construct the new pathname
  const newPathname = pathParts.join('/');
  
  // Return the parent container URL
  return `${urlObj.protocol}//${urlObj.host}${newPathname}/`;
} 