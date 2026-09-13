import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

/**
 * Per-component Mantine styles rather than the whole bundle. This app uses
 * about fifteen of Mantine's components; importing all of them cost roughly
 * five times the CSS. Add the matching import here when you introduce a new
 * component, or it will render unstyled.
 */
import '@mantine/core/styles/baseline.css';
import '@mantine/core/styles/default-css-variables.css';
import '@mantine/core/styles/global.css';
import '@mantine/core/styles/UnstyledButton.css';
import '@mantine/core/styles/VisuallyHidden.css';
import '@mantine/core/styles/Paper.css';
import '@mantine/core/styles/Overlay.css';
import '@mantine/core/styles/ModalBase.css';
import '@mantine/core/styles/Input.css';
import '@mantine/core/styles/InlineInput.css';
import '@mantine/core/styles/Flex.css';
import '@mantine/core/styles/Divider.css';
import '@mantine/core/styles/FloatingIndicator.css';
import '@mantine/core/styles/ScrollArea.css';
import '@mantine/core/styles/Popover.css';
import '@mantine/core/styles/CloseButton.css';
import '@mantine/core/styles/Combobox.css';
import '@mantine/core/styles/ActionIcon.css';
import '@mantine/core/styles/Anchor.css';
import '@mantine/core/styles/Badge.css';
import '@mantine/core/styles/Button.css';
import '@mantine/core/styles/Group.css';
import '@mantine/core/styles/Loader.css';
import '@mantine/core/styles/Modal.css';
import '@mantine/core/styles/Splitter.css';
import '@mantine/core/styles/Stack.css';
import '@mantine/core/styles/Tabs.css';
import '@mantine/core/styles/Text.css';
import '@mantine/core/styles/Tooltip.css';

import './index.css';

import { MantineProvider } from '@mantine/core';
import App from './App.tsx';
import { theme } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);
