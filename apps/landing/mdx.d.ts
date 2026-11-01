declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types';

  export default function MDXContent(props: MDXProps): JSX.Element;

  export const metadata: {
    title: string;
    description: string;
    date: string;
    author: string;
    releaseChannel?: 'stable' | 'dev';
    targetVersion?: string;
  };
}
