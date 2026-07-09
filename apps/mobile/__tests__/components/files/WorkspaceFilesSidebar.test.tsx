import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { WorkspaceFilesSidebar } from '@/src/components/files/WorkspaceFilesSidebar';

const mockUseWorkspace = jest.fn();
const mockUseConversations = jest.fn();
const mockUseFilesTab = jest.fn();
const mockUseWorkspaceAttachments = jest.fn();
const mockBridgeRequest = jest.fn();

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/src/context/WorkspaceContext', () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

jest.mock('@/src/context/ConversationContext', () => ({
  useConversations: () => mockUseConversations(),
}));

jest.mock('@/src/context/FilesTabContext', () => ({
  useFilesTab: () => mockUseFilesTab(),
}));

jest.mock('@/src/context/WorkspaceAttachmentContext', () => ({
  useWorkspaceAttachments: () => mockUseWorkspaceAttachments(),
}));

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: (...args: unknown[]) => mockBridgeRequest(...args),
  },
}));

describe('WorkspaceFilesSidebar', () => {
  beforeEach(() => {
    mockBridgeRequest.mockReset();
    mockUseWorkspace.mockReturnValue({
      currentWorkspace: '/tmp/project',
      workspaceDisplayName: 'project',
      workspaceChanged: false,
    });
    mockUseConversations.mockReturnValue({ activeConversationId: 'conv-1' });
    mockUseFilesTab.mockReturnValue({ openTab: jest.fn() });
    mockUseWorkspaceAttachments.mockReturnValue({ addPendingFiles: jest.fn() });
    mockBridgeRequest.mockResolvedValue([
      {
        name: 'project',
        fullPath: '/tmp/project',
        relativePath: '',
        isDir: true,
        isFile: false,
        children: [
          {
            name: 'README.md',
            fullPath: '/tmp/project/README.md',
            relativePath: 'README.md',
            isDir: false,
            isFile: true,
          },
        ],
      },
    ]);
  });

  it('adds a workspace file to the active chat attachments', async () => {
    const addPendingFiles = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockUseWorkspaceAttachments.mockReturnValue({ addPendingFiles });

    const screen = render(<WorkspaceFilesSidebar navigation={{ closeDrawer: jest.fn(), openDrawer: jest.fn() }} />);

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('add-file-to-chat-README.md'));

    expect(addPendingFiles).toHaveBeenCalledWith('conv-1', ['/tmp/project/README.md']);
    expect(alertSpy).toHaveBeenCalledWith('Added to chat', 'README.md');
    alertSpy.mockRestore();
  });
});
