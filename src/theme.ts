import { createTheme, type MantineThemeOverride } from '@mantine/core';

/**
 * Compact by default. Mantine's stock sizing is built for marketing pages; this
 * is a tool you scan, so everything steps down a size and the vertical rhythm
 * tightens. Row metrics live in CSS variables so the tree and the chrome agree.
 */
export const theme: MantineThemeOverride = createTheme({
  fontFamily: "'Inter Variable', system-ui, -apple-system, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono Variable', Menlo, Consolas, monospace",
  headings: {
    fontFamily: "'Inter Variable', system-ui, sans-serif",
    sizes: {
      h1: { fontSize: '18px', fontWeight: '600' },
      h2: { fontSize: '16px', fontWeight: '600' },
      h3: { fontSize: '14px', fontWeight: '600' },
      h4: { fontSize: '12px', fontWeight: '600' },
      h5: { fontSize: '11px', fontWeight: '600' },
      h6: { fontSize: '11px', fontWeight: '600' },
    },
  },
  fontSizes: {
    xs: '10px',
    sm: '11px',
    md: '12px',
    lg: '13px',
    xl: '15px',
  },
  spacing: {
    xs: '4px',
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
  },
  radius: {
    xs: '2px',
    sm: '3px',
    md: '4px',
    lg: '6px',
    xl: '8px',
  },
  defaultRadius: 'sm',
  primaryColor: 'blue',
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { size: 'xs' } },
    TextInput: { defaultProps: { size: 'xs' } },
    Select: { defaultProps: { size: 'xs' } },
    ActionIcon: { defaultProps: { size: 'sm' } },
    Badge: { defaultProps: { size: 'xs' } },
    Modal: { defaultProps: { radius: 'md', transitionProps: { duration: 120 } } },
    Tooltip: { defaultProps: { openDelay: 400, transitionProps: { duration: 80 } } },
  },
});

/** Single source of truth for tree row geometry, shared with the virtualiser. */
export const ROW_HEIGHT = 22;
export const INDENT_WIDTH = 12;
