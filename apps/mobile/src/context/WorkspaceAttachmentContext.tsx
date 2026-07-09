import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type WorkspaceAttachmentContextType = {
  addPendingFiles: (conversationId: string, files: string[]) => void;
  consumePendingFiles: (conversationId: string) => string[];
};

const WorkspaceAttachmentContext = createContext<WorkspaceAttachmentContextType | null>(null);

export function WorkspaceAttachmentProvider({ children }: { children: React.ReactNode }) {
  const [pendingByConversation, setPendingByConversation] = useState<Record<string, string[]>>({});

  const addPendingFiles = useCallback((conversationId: string, files: string[]) => {
    const nextFiles = uniqueFiles(files);
    if (!conversationId || nextFiles.length === 0) return;
    setPendingByConversation((current) => ({
      ...current,
      [conversationId]: uniqueFiles([...(current[conversationId] ?? []), ...nextFiles]),
    }));
  }, []);

  const consumePendingFiles = useCallback((conversationId: string) => {
    if (!conversationId) return [];
    const pending = pendingByConversation[conversationId] ?? [];
    if (pending.length === 0) return [];
    setPendingByConversation((current) => {
      const { [conversationId]: _consumed, ...rest } = current;
      return rest;
    });
    return pending;
  }, [pendingByConversation]);

  const value = useMemo(
    () => ({ addPendingFiles, consumePendingFiles }),
    [addPendingFiles, consumePendingFiles],
  );

  return <WorkspaceAttachmentContext.Provider value={value}>{children}</WorkspaceAttachmentContext.Provider>;
}

export function useWorkspaceAttachments() {
  const context = useContext(WorkspaceAttachmentContext);
  if (!context) {
    throw new Error('useWorkspaceAttachments must be used within a WorkspaceAttachmentProvider');
  }
  return context;
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter((file) => typeof file === 'string' && file.length > 0)));
}
