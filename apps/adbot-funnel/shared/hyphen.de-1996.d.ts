declare module "hyphen/de-1996" {
  type HyphenOptions = {
    minWordLength?: number;
    hyphenChar?: string;
    exceptions?: string[];
  };

  export function hyphenateSync(text: string, options?: HyphenOptions): string;
  export function hyphenateHTMLSync(html: string, options?: HyphenOptions): string;
}
