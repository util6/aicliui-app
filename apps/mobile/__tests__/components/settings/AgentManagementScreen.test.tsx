import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AgentManagementScreen } from '@/src/components/settings/AgentManagementScreen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockListManagedAgents = jest.fn();
const mockHealthCheckAgent = jest.fn();
const mockSetAgentEnabled = jest.fn();
const mockCreateCustomAgent = jest.fn();
const mockUpdateCustomAgent = jest.fn();
const mockDeleteCustomAgent = jest.fn();
const mockTestCustomAgent = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock('@/src/context/ConnectionContext', () => ({
  useConnection: () => ({ isConfigured: true, isRestoring: false }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/src/services/agentManagement', () => ({
  listManagedAgents: (...args: unknown[]) => mockListManagedAgents(...args),
  healthCheckAgent: (...args: unknown[]) => mockHealthCheckAgent(...args),
  setAgentEnabled: (...args: unknown[]) => mockSetAgentEnabled(...args),
  createCustomAgent: (...args: unknown[]) => mockCreateCustomAgent(...args),
  updateCustomAgent: (...args: unknown[]) => mockUpdateCustomAgent(...args),
  deleteCustomAgent: (...args: unknown[]) => mockDeleteCustomAgent(...args),
  testCustomAgent: (...args: unknown[]) => mockTestCustomAgent(...args),
  parseAgentArgs: (value: string) => value.trim() ? value.trim().split(/\s+/) : [],
  parseEnvironmentText: () => [],
  serializeEnvironmentEntries: () => '',
}));

const agents = [
  {
    id: 'opencode',
    name: 'OpenCode',
    backend: 'opencode',
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: true,
    status: 'online',
    args: [],
    env: [],
  },
  {
    id: 'custom-1',
    name: 'My CLI',
    command: 'my-cli',
    agent_type: 'acp',
    agent_source: 'custom',
    enabled: true,
    installed: true,
    status: 'online',
    args: ['--acp'],
    env: [],
  },
];

describe('AgentManagementScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListManagedAgents.mockResolvedValue(agents);
    mockHealthCheckAgent.mockResolvedValue(agents[0]);
    mockSetAgentEnabled.mockResolvedValue(undefined);
    mockCreateCustomAgent.mockResolvedValue(undefined);
    mockUpdateCustomAgent.mockResolvedValue(undefined);
    mockDeleteCustomAgent.mockResolvedValue(undefined);
    mockTestCustomAgent.mockResolvedValue({ step: 'success' });
  });

  it('lists official and custom agents and supports health checks and toggles', async () => {
    const screen = render(<AgentManagementScreen />);

    await waitFor(() => expect(screen.getByText('OpenCode')).toBeTruthy());
    expect(screen.getByText('My CLI')).toBeTruthy();

    fireEvent.press(screen.getByTestId('agent-health-opencode'));
    await waitFor(() => expect(mockHealthCheckAgent).toHaveBeenCalledWith('opencode'));

    fireEvent(screen.getByTestId('agent-toggle-custom-1'), 'valueChange', false);
    await waitFor(() => expect(mockSetAgentEnabled).toHaveBeenCalledWith('custom-1', false));
  });

  it('tests and creates a custom ACP CLI from the mobile editor', async () => {
    const screen = render(<AgentManagementScreen />);
    await waitFor(() => expect(screen.getByText('OpenCode')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-custom-agent'));
    fireEvent.changeText(screen.getByTestId('agent-name-input'), 'New CLI');
    fireEvent.changeText(screen.getByTestId('agent-command-input'), 'new-cli');
    fireEvent.changeText(screen.getByTestId('agent-args-input'), '--acp');

    fireEvent.press(screen.getByTestId('test-custom-agent'));
    await waitFor(() => expect(mockTestCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New CLI',
      command: 'new-cli',
      args: ['--acp'],
    })));

    fireEvent.press(screen.getByTestId('save-custom-agent'));
    await waitFor(() => expect(mockCreateCustomAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New CLI',
      command: 'new-cli',
      args: ['--acp'],
    })));
  });
});
