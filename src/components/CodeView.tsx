import { Suspense, lazy, useMemo } from 'react';
import { Loader } from '@mantine/core';

/**
 * CodeMirror and its language modes are a large chunk that nobody needs until
 * they open a file or the export dialog. Splitting it here keeps it out of the
 * entry bundle, so first paint is the tree and nothing else.
 */
const LazyEditor = lazy(async () => {
  const [
    { default: CodeMirror },
    { vscodeDark },
    { javascript },
    { html },
    { css },
    { json },
    { markdown },
  ] = await Promise.all([
    import('@uiw/react-codemirror'),
    import('@uiw/codemirror-theme-vscode'),
    import('@codemirror/lang-javascript'),
    import('@codemirror/lang-html'),
    import('@codemirror/lang-css'),
    import('@codemirror/lang-json'),
    import('@codemirror/lang-markdown'),
  ]);

  const extensionsFor = (filename: string) => {
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return [javascript({ jsx: true, typescript: true })];
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return [javascript({ jsx: true })];
      case 'html':
        return [html()];
      case 'css':
      case 'scss':
        return [css()];
      case 'json':
        return [json()];
      case 'md':
      case 'mdx':
        return [markdown()];
      default:
        return [];
    }
  };

  function Editor({ value, filename, readOnly, height, onChange }: CodeViewProps) {
    const extensions = useMemo(() => extensionsFor(filename ?? ''), [filename]);
    return (
      <CodeMirror
        value={value}
        height={height ?? '100%'}
        readOnly={readOnly}
        theme={vscodeDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: !readOnly,
          highlightActiveLine: !readOnly,
          foldGutter: !readOnly,
          autocompletion: false,
        }}
      />
    );
  }

  return { default: Editor };
});

export interface CodeViewProps {
  value: string;
  /** Drives syntax highlighting. Omit for plain text. */
  filename?: string;
  readOnly?: boolean;
  height?: string;
  onChange?: (value: string) => void;
}

function EditorFallback({ height }: { height?: string }) {
  return (
    <div
      style={{
        height: height ?? '100%',
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Loader size="xs" />
    </div>
  );
}

export function CodeView(props: CodeViewProps) {
  return (
    <Suspense fallback={<EditorFallback height={props.height} />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
