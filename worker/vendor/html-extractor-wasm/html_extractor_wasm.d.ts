/* tslint:disable */
/* eslint-disable */

export type PageType =
| "article"
| "forum"
| "product"
| "listing"
| "collection"
| "documentation"
| "service"
| "other";

export interface ExtractOptions {
    url?: string;
    favorPrecision?: boolean;
    favorRecall?: boolean;
    outputText?: boolean;
    outputDecisions?: boolean;
    targetLanguage?: string;
    pageTypeOverride?: PageType;
    includeLinks?: boolean;
    includeTables?: boolean;
    includeImages?: boolean;
    includeMetadata?: boolean;
    minExtractionLength?: number;
    maxInputSize?: number;
}

export interface Metadata {
    title?: string;
    description?: string;
    author?: string;
    publishedDate?: string;
    siteName?: string;
    imageUrl?: string;
    canonicalUrl?: string;
    language?: string;
    keywords: string[];
}

export interface ExtractStats {
    textChars: number;
    elementCount: number;
    usedFallback: boolean;
    pageType: PageType;
}

export interface ExtractResult {
    markdown: string;
    text?: string;
    pageType: PageType;
    extractionQuality: number;
    language?: string;
    metadata?: Metadata;
    stats?: ExtractStats;
    errorReason?: string;
}



/**
 * Extracts the main content from an HTML document.
 *
 * The second argument accepts the same camel-case options as the Node.js API.
 */
export function extract(html: string, options?: ExtractOptions): ExtractResult;

/**
 * Returns the package version.
 */
export function version(): string;
