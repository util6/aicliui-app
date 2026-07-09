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

  it('adds a workspace folder to the active chat attachments', async () => {
    const addPendingFiles = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockUseWorkspaceAttachments.mockReturnValue({ addPendingFiles });
    mockBridgeRequest.mockResolvedValueOnce([
      {
        name: 'project',
        fullPath: '/tmp/project',
        relativePath: '',
        isDir: true,
        isFile: false,
        children: [
          {
            name: 'src',
            fullPath: '/tmp/project/src',
            relativePath: 'src',
            isDir: true,
            isFile: false,
            children: [],
          },
        ],
      },
    ]);

    const screen = render(<WorkspaceFilesSidebar navigation={{ closeDrawer: jest.fn(), openDrawer: jest.fn() }} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('add-file-to-chat-src'));

    expect(addPendingFiles).toHaveBeenCalledWith('conv-1', ['/tmp/project/src']);
    expect(alertSpy).toHaveBeenCalledWith('Added to chat', 'src');
    alertSpy.mockRestore();
  });

  it('confirms before deleting a workspace file and refreshes the tree', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    mockBridgeRequest
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce([
        {
          name: 'project',
          fullPath: '/tmp/project',
          relativePath: '',
          isDir: true,
          isFile: false,
          children: [],
        },
      ]);

    const screen = render(<WorkspaceFilesSidebar navigation={{ closeDrawer: jest.fn(), openDrawer: jest.fn() }} />);

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('delete-workspace-entry-README.md'));

    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('workspace.removeEntry', {
        workspace: '/tmp/project',
        path: '/tmp/project/README.md',
      });
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete file?',
      'README.md',
      expect.arrayContaining([expect.objectContaining({ style: 'destructive' })]),
    );
    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledTimes(3);
    });
    alertSpy.mockRestore();
  });

  it('renames a workspace entry and refreshes the tree', async () => {
    mockBridgeRequest
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce({ new_path: '/tmp/project/NOTES.md' })
      .mockResolvedValueOnce([
        {
          name: 'project',
          fullPath: '/tmp/project',
          relativePath: '',
          isDir: true,
          isFile: false,
          children: [
            {
              name: 'NOTES.md',
              fullPath: '/tmp/project/NOTES.md',
              relativePath: 'NOTES.md',
              isDir: false,
              isFile: true,
            },
          ],
        },
      ]);

    const screen = render(<WorkspaceFilesSidebar navigation={{ closeDrawer: jest.fn(), openDrawer: jest.fn() }} />);

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('rename-workspace-entry-README.md'));
    fireEvent.changeText(screen.getByTestId('rename-workspace-entry-input-README.md'), 'NOTES.md');
    fireEvent.press(screen.getByTestId('save-workspace-entry-rename-README.md'));

    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('workspace.renameEntry', {
        workspace: '/tmp/project',
        path: '/tmp/project/README.md',
        new_name: 'NOTES.md',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('NOTES.md')).toBeTruthy();
    });
  });
});
